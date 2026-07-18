import { BrowserWindow } from "electrobun/bun";

new BrowserWindow({
	title: "niwaterm",
	url: "views://mainview/index.html",
	frame: {
		width: 900,
		height: 600,
		x: 200,
		y: 200,
	},
});

console.log("niwaterm started");
