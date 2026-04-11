import { ExtendedClient } from "../structure";

export async function resumePendingDeletes(client: ExtendedClient): Promise<void> {
	const delayMinutes = parseInt(client.runtimeConfig.get("closed_delete_delay") ?? "10", 10);
	const delayMs = delayMinutes * 60 * 1000;

	const closedTickets = await client.prisma.tickets.findMany({
		where: {
			closedat: { not: null },
			closedby: { not: null },
		},
	});

	for (const ticket of closedTickets) {
		if (!ticket.closedat) continue;

		const elapsed = Date.now() - Number(ticket.closedat);
		const remaining = delayMs - elapsed;

		try {
			const channel = await client.channels.fetch(ticket.channelid).catch(() => null);
			if (!channel) continue; // Already deleted

			if (remaining <= 0) {
				await channel.delete().catch((e) => console.log(e));
			} else {
				setTimeout(() => channel.delete().catch((e) => console.log(e)), remaining);
			}
		} catch {
			// Channel doesn't exist, skip
		}
	}
}
