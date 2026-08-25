// electrobun.config.tsのscripts.preBuildは単一スクリプトしか指定できないため、
// 複数のpreBuild処理をこのエントリ経由でまとめて実行する。
import "./write-app-variant";
import "./build-tailwind";
