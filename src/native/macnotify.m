// macOS向けデスクトップ通知ヘルパー（src/bun/mac-notification.tsから bun:ffi で呼ぶ）。
//
// ElectrobunのUtils.showNotificationはUNUserNotificationCenterのdelegateを設定しないため、
// 通知をクリックしてもアプリが前面に出るだけで、どの通知が押されたかを受け取れない。
// ここでは自前でdelegateを設定し、通知のuserInfoへ通知元のtabIdを載せて、クリック時にそれを返す。
//
// adhoc署名のdevビルド等ではUNUserNotificationCenterの許可が得られず、通知がUNErrorDomain Code=1で
// 弾かれる。その場合はElectrobunと同じく非推奨のNSUserNotificationCenterへフォールバックする
// （こちらは許可なしで表示でき、delegateでクリックも受け取れる）。
//
// delegateのコールバックはUserNotificationsの内部キューから呼ばれ、Bunのアプリコード（Worker）とは
// 別スレッドになる。JSCallbackはWorker内で無言で発火しないことがあるため、クリックされたtabIdは
// ロック付きのキューへ積むだけにし、Bun側がポーリングで取り出す。

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

static NSMutableArray<NSString *> *clickedTabIds;
static volatile BOOL modernAuthorized = NO;

static void pushClickedTabId(id tabId) {
  if (![tabId isKindOfClass:[NSString class]]) return;
  @synchronized(clickedTabIds) {
    [clickedTabIds addObject:tabId];
  }
}

@interface NiwaNotificationDelegate
    : NSObject <UNUserNotificationCenterDelegate, NSUserNotificationCenterDelegate>
@end

@implementation NiwaNotificationDelegate

// delegateを設定するとアプリが前面にある間の通知は既定で表示されなくなる。ベルは
// 前面でも「別タブで鳴った」場合に出したいので、常にバナー表示させる
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
  completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList |
                    UNNotificationPresentationOptionSound);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
  if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
    pushClickedTabId(response.notification.request.content.userInfo[@"tabId"]);
  }
  completionHandler();
}

// 以下はNSUserNotificationCenter（フォールバック）向け。前面でも表示する理由はwillPresentNotificationと同じ
- (BOOL)userNotificationCenter:(NSUserNotificationCenter *)center
     shouldPresentNotification:(NSUserNotification *)notification {
  return YES;
}

- (void)userNotificationCenter:(NSUserNotificationCenter *)center
       didActivateNotification:(NSUserNotification *)notification {
  // 通知スタイルが「通知パネル」だとクリック後も画面に残り続けるため、明示的に取り除く
  [center removeDeliveredNotification:notification];
  if (notification.activationType != NSUserNotificationActivationTypeContentsClicked &&
      notification.activationType != NSUserNotificationActivationTypeActionButtonClicked)
    return;
  pushClickedTabId(notification.userInfo[@"tabId"]);
}

@end

static NiwaNotificationDelegate *delegate;

static NSString *stringOrNil(const char *s) {
  return s ? [NSString stringWithUTF8String:s] : nil;
}

/**
 * delegateを設定して通知の許可を求める。通知を出す前に1回だけ呼ぶ。
 * 0: 成功 / -1: アプリバンドル外で実行されている（UNUserNotificationCenterが使えない）
 */
int niwa_mac_notify_init(void) {
  @autoreleasepool {
    // バンドルIDが無いプロセスでcurrentNotificationCenterを呼ぶと例外で落ちる
    if (NSBundle.mainBundle.bundleIdentifier == nil) return -1;
    clickedTabIds = [NSMutableArray array];
    delegate = [NiwaNotificationDelegate new];
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    center.delegate = delegate;
    NSUserNotificationCenter.defaultUserNotificationCenter.delegate = delegate;
    [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound)
                          completionHandler:^(BOOL granted, NSError *error) {
                            modernAuthorized = granted && error == nil;
                          }];
    return 0;
  }
}

static void showLegacy(NSString *title, NSString *body, NSString *subtitle, BOOL silent,
                       NSDictionary *userInfo) {
  NSUserNotification *notification = [NSUserNotification new];
  notification.title = title;
  notification.informativeText = body;
  notification.subtitle = subtitle;
  if (!silent) notification.soundName = NSUserNotificationDefaultSoundName;
  notification.userInfo = userInfo;
  [NSUserNotificationCenter.defaultUserNotificationCenter deliverNotification:notification];
}

/** 通知を出す。body/subtitle/tabIdはNULL可。tabIdを渡すとクリック時にniwa_mac_notify_poll_clickで返る */
void niwa_mac_notify_show(const char *title, const char *body, const char *subtitle, int silent,
                          const char *tabId) {
  @autoreleasepool {
    NSString *titleStr = stringOrNil(title) ?: @"";
    NSString *bodyStr = stringOrNil(body);
    NSString *subtitleStr = stringOrNil(subtitle);
    NSString *tabIdStr = stringOrNil(tabId);
    NSDictionary *userInfo = tabIdStr ? @{@"tabId" : tabIdStr} : nil;

    if (!modernAuthorized) {
      showLegacy(titleStr, bodyStr, subtitleStr, silent, userInfo);
      return;
    }

    UNMutableNotificationContent *content = [UNMutableNotificationContent new];
    content.title = titleStr;
    if (bodyStr) content.body = bodyStr;
    if (subtitleStr) content.subtitle = subtitleStr;
    if (!silent) content.sound = UNNotificationSound.defaultSound;
    if (userInfo) content.userInfo = userInfo;

    UNNotificationRequest *request =
        [UNNotificationRequest requestWithIdentifier:NSUUID.UUID.UUIDString
                                             content:content
                                             trigger:nil];
    [UNUserNotificationCenter.currentNotificationCenter
        addNotificationRequest:request
         withCompletionHandler:^(NSError *error) {
           if (!error) return;
           NSLog(@"[niwaterm] failed to show notification, falling back to legacy API: %@", error);
           dispatch_async(dispatch_get_main_queue(), ^{
             showLegacy(titleStr, bodyStr, subtitleStr, silent, userInfo);
           });
         }];
  }
}

/**
 * クリックされた通知のtabIdを古い順に1件取り出し、NUL終端でbufへ書き込む。
 * 戻り値: 書き込んだバイト数（NUL除く）/ 0: キューが空 / -1: bufが小さすぎる（その1件は捨てる）
 */
int niwa_mac_notify_poll_click(char *buf, int len) {
  @autoreleasepool {
    NSString *tabId;
    @synchronized(clickedTabIds) {
      if (clickedTabIds.count == 0) return 0;
      tabId = clickedTabIds.firstObject;
      [clickedTabIds removeObjectAtIndex:0];
    }
    const char *utf8 = tabId.UTF8String;
    size_t n = strlen(utf8);
    if (n + 1 > (size_t)len) return -1;
    memcpy(buf, utf8, n + 1);
    return (int)n;
  }
}
