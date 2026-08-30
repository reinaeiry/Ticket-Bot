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
