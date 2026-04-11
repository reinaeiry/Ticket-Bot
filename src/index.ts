import fs from "fs-extra";
import path from "node:path";
import { GatewayIntentBits } from "discord.js";
import { jsonc } from "jsonc";
import { config as envconf } from "dotenv";
import {ConfigType, ExtendedClient} from "./structure";

try {envconf();}
catch {console.log(".env failed to load");}

process.on("unhandledRejection", (reason: string, promise: string, a: string) => {
	console.error(reason, promise, a);
});

process.on("uncaughtException", (err: string) => {
	console.error(err);
});

console.log("Connecting to Discord...");

const config: ConfigType = jsonc.parse(fs.readFileSync(path.join(__dirname, "/../config/config.jsonc"), "utf8"));

const client = new ExtendedClient({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
	presence: {
		status: config.status?.status ?? "online"
	}
}, config);

const token = process.env["TOKEN"];
if(!token || token.trim() === "")
	throw new Error("TOKEN Environment Not Found");
client.login(process.env["TOKEN"]).then(null);
