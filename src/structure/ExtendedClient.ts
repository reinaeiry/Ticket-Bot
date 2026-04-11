import {Client, ClientOptions, Collection, Routes} from "discord.js";
import {BaseCommand, ConfigType} from "./";
import {PrismaClient} from "@prisma/client";
import fs from "fs-extra";
import path from "node:path";
import {
	AddCommand, MassAddCommand, ClaimCommand, CloseCommand, RemoveCommand, RenameCommand, clearDM,
	Na1CategoryOpenCommand, Na2CategoryOpenCommand, Eu1CategoryOpenCommand, Eu2CategoryOpenCommand,
	BanAppealCategoryOpenCommand, ClaimedCategoryCommand, SetRoleCommand, SetClosedDelayCommand,
	GmAppCategoryOpenCommand, CloseCategoryCommand, DevAppCategoryOpenCommand,
} from "../commands";
import {InteractionCreateEvent, ReadyEvent, MessageCreateEvent} from "../events";
import {jsonc} from "jsonc";
import {REST} from "@discordjs/rest";
import {Translation} from "../utils/translation";

export default class ExtendedClient extends Client {
	public config: ConfigType;
	public readonly prisma: PrismaClient;
	public locales: Translation;
	public commands: Collection<string, BaseCommand>;
	public runtimeConfig: Map<string, string> = new Map();

	constructor(options: ClientOptions, config: ConfigType) {
		super(options);

		this.config = config;
		this.prisma = new PrismaClient({
			errorFormat: "minimal"
		});
		this.locales = new Translation(this.config.lang, path.join(__dirname, "../../locales/"));
		this.commands = new Collection([
			[AddCommand.data.name, new AddCommand(this)],
			[MassAddCommand.data.name, new MassAddCommand(this)],
			[ClaimCommand.data.name, new ClaimCommand(this)],
			[CloseCommand.data.name, new CloseCommand(this)],
			[RemoveCommand.data.name, new RemoveCommand(this)],
			[RenameCommand.data.name, new RenameCommand(this)],
			[clearDM.data.name, new clearDM(this)],
			[Na1CategoryOpenCommand.data.name, new Na1CategoryOpenCommand(this)],
			[Na2CategoryOpenCommand.data.name, new Na2CategoryOpenCommand(this)],
			[Eu1CategoryOpenCommand.data.name, new Eu1CategoryOpenCommand(this)],
			[Eu2CategoryOpenCommand.data.name, new Eu2CategoryOpenCommand(this)],
			[BanAppealCategoryOpenCommand.data.name, new BanAppealCategoryOpenCommand(this)],
			[ClaimedCategoryCommand.data.name, new ClaimedCategoryCommand(this)],
			[SetRoleCommand.data.name, new SetRoleCommand(this)],
			[SetClosedDelayCommand.data.name, new SetClosedDelayCommand(this)],
			[GmAppCategoryOpenCommand.data.name, new GmAppCategoryOpenCommand(this)],
			[CloseCategoryCommand.data.name, new CloseCategoryCommand(this)],
			[DevAppCategoryOpenCommand.data.name, new DevAppCategoryOpenCommand(this)],
		]);
		this.loadEvents();

	}

	public msToHm (ms: number | Date) {

		if(ms instanceof Date) ms = ms.getTime();

		const days = Math.floor(ms / (24 * 60 * 60 * 1000));
		const daysms = ms % (24 * 60 * 60 * 1000);
		const hours = Math.floor(daysms / (60 * 60 * 1000));
		const hoursms = ms % (60 * 60 * 1000);
		const minutes = Math.floor(hoursms / (60 * 1000));
		const minutesms = ms % (60 * 1000);
		const sec = Math.floor(minutesms / 1000);

		let result = "0s";

		if (days > 0) result = `${days}d ${hours}h ${minutes}m ${sec}s`;
		if (hours > 0) result = `${hours}h ${minutes}m ${sec}s`;
		if (minutes > 0) result = `${minutes}m ${sec}s`;
		if (sec > 0) result = `${sec}s`;
		return result;

	}

	private loadEvents () {
		this.on("interactionCreate", (interaction) => new InteractionCreateEvent(this).execute(interaction));
		this.on("ready", () => new ReadyEvent(this).execute());
		this.on("messageCreate", (message) => new MessageCreateEvent(this).execute(message));
	}

	public async loadRuntimeConfig(): Promise<void> {
		const rows = await this.prisma.config.findMany();
		for (const row of rows) {
			if (row.value) this.runtimeConfig.set(row.key, row.value);
		}

		const categoryMap: Record<string, string> = {
			"na1-support": "category_na1_open",
			"na2-support": "category_na2_open",
			"eu1-support": "category_eu1_open",
			"eu2-support": "category_eu2_open",
			"ban-appeal": "category_banappeal_open",
			"gm-application": "category_gmapp_open",
			"dev-application": "category_devapp_open",
		};

		for (const tt of this.config.ticketTypes) {
			const dbKey = categoryMap[tt.codeName];
			if (dbKey && this.runtimeConfig.has(dbKey)) {
				tt.categoryId = this.runtimeConfig.get(dbKey)!;
			}
		}

		const closedCat = this.runtimeConfig.get("category_closed");
		if (closedCat) this.config.closeOption.closeTicketCategoryId = closedCat;

		const claimedCat = this.runtimeConfig.get("category_claimed");
		if (claimedCat) this.config.claimOption.categoryWhenClaimed = claimedCat;

		const staffRole = this.runtimeConfig.get("staff_role");
		if (staffRole) this.config.rolesWhoHaveAccessToTheTickets = [staffRole];
	}

	public deployCommands() {
		const commands = [
			AddCommand.data.toJSON(),
			ClaimCommand.data.toJSON(),
			CloseCommand.data.toJSON(),
			RemoveCommand.data.toJSON(),
			RenameCommand.data.toJSON(),
			clearDM.data.toJSON(),
			Na1CategoryOpenCommand.data.toJSON(),
			Na2CategoryOpenCommand.data.toJSON(),
			Eu1CategoryOpenCommand.data.toJSON(),
			Eu2CategoryOpenCommand.data.toJSON(),
			BanAppealCategoryOpenCommand.data.toJSON(),
			ClaimedCategoryCommand.data.toJSON(),
			SetRoleCommand.data.toJSON(),
			SetClosedDelayCommand.data.toJSON(),
			GmAppCategoryOpenCommand.data.toJSON(),
			CloseCategoryCommand.data.toJSON(),
			DevAppCategoryOpenCommand.data.toJSON(),
		];

		const { guildId } = jsonc.parse(fs.readFileSync(path.join(__dirname, "../../config/config.jsonc"), "utf8"));

		if(!process.env["TOKEN"]) throw Error("Discord Token Expected, deploy-command");
		const rest = new REST({ version: "10" }).setToken(process.env["TOKEN"]);

		rest
			.put(Routes.applicationGuildCommands(this.user?.id ?? "", guildId), { body: commands })
			.then(() => console.log("✅  Successfully registered application commands."))
			.catch(console.error);
	}
}
