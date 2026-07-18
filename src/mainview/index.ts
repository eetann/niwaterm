console.log("niwaterm view loaded");

const status = document.getElementById("status");
if (status) {
	status.textContent = `webview loaded at ${new Date().toLocaleTimeString()}`;
}
