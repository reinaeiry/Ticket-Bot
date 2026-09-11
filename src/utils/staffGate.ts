import { GuildMember } from "discord.js";
import { ExtendedClient } from "../structure";

/**
 * Who may run a command tied to a particular ticket panel.
 *
 * The trap this exists to close: `config.rolesWhoHaveAccessToTheTickets` looks
 * like "the staff roles", but ExtendedClient overwrites whatever is in
 * config.jsonc with a single role from the SQLite config table (`staff_role`,
 * currently Global Admin). Checking only that list refuses the **Founder**,
 * who holds no Global Admin role — which is exactly how /syncperms once locked
 * the owner out, and how /billing and /relink did again.
 *
 * So the allowed set is that global role UNION the panel's own `staffRoles`.
 * Both come from config, so widening access later is a config edit rather than
 * a code change.
 *
 * Panel-scoped rather than a blanket union on purpose: the union of every
 * panel's staffRoles includes the six Gamemaster roles, and commands gated
 * with this one reach payment data and account access.
 */
export function hasPanelAccess(
	client: ExtendedClient,
	member: GuildMember | null,
	panelCodeName: string,
	opts: { includeGlobalStaffRole?: boolean } = {}
): boolean {
	if (!member) return false;
	const { includeGlobalStaffRole = true } = opts;

	const allowed = new Set<string>(
		includeGlobalStaffRole ? client.config.rolesWhoHaveAccessToTheTickets ?? [] : []
	);
	const panel = client.config.ticketTypes?.find((t) => t.codeName === panelCodeName);
	for (const roleId of panel?.staffRoles ?? []) allowed.add(roleId);

	return member.roles.cache.some((r) => allowed.has(r.id));
}

/**
 * Strictest gate available: the panel's OWN staffRoles only, with the global
 * staff role deliberately excluded.
 *
 * For `shop-support` that is the Founder role and nothing else. Used by
 * /refund, because moving money is not something the global staff role
 * (Global Admin) should be able to do just by virtue of seeing every ticket.
 * Still config-driven, so widening it later is a config.jsonc edit.
 */
export function hasPanelAccessStrict(
	client: ExtendedClient,
	member: GuildMember | null,
	panelCodeName: string
): boolean {
	return hasPanelAccess(client, member, panelCodeName, { includeGlobalStaffRole: false });
}

/**
 * Who may add people to a ticket or remove them: the member who opened it, or
 * the staff roles that ticket's own panel names -- the same set that can see the
 * channel. The global staff role alone does not count. Since 40b8fba it no
 * longer grants channel access to panels that do not list it (Shop Support,
 * Contact Management, the applications), so it must not let anyone add people
 * to those tickets either.
 *
 * /add, /remove and the removeUser menu had no check at all. Anyone who could
 * type in a ticket -- someone merely added to it included -- could pull in any
 * member, who then reads the whole history, and could operate a remove menu that
 * is posted in the channel for everyone. The creator adding a friend and staff
 * managing a ticket both still work.
 *
 * A category that fails to parse admits the creator only, rather than throwing
 * mid-interaction.
 */
export function canManageTicketMembers(
	client: ExtendedClient,
	member: GuildMember | null,
	ticket: { creator: string; category: string }
): boolean {
	if (!member) return false;
	if (member.id === ticket.creator) return true;
	let codeName = "";
	try {
		codeName = (JSON.parse(ticket.category) as { codeName?: string }).codeName ?? "";
	} catch {
		codeName = "";
	}
	return hasPanelAccessStrict(client, member, codeName);
}
