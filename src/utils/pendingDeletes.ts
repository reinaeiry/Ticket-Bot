import { ExtendedClient } from "../structure";

export async function resumePendingDeletes(client: ExtendedClient): Promise<void> {
	const delayMinutes = parseInt(client.runtimeConfig.get("closed_delete_delay") ?? "10", 10);
	const delayMs = delayMinutes * 60 * 1000;

	// Resume auto-delete timers for closed tickets
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
			if (!channel) continue;

			if (remaining <= 0) {
				await channel.delete().catch((e) => console.log(e));
			} else {
				setTimeout(() => channel.delete().catch((e) => console.log(e)), remaining);
			}
		} catch {
			// Channel doesn't exist, skip
		}
	}

	// Clean up orphaned tickets - channels that no longer exist but DB still says open
	const openTickets = await client.prisma.tickets.findMany({
		where: {
			closedby: null,
		},
	});

	for (const ticket of openTickets) {
		try {
			const channel = await client.channels.fetch(ticket.channelid).catch(() => null);
			if (!channel) {
				// Channel is gone but ticket is still "open" in DB - close it
				await client.prisma.tickets.update({
					data: {
						closedby: "system",
						closedat: Date.now(),
						closereason: "Channel deleted",
					},
					where: { channelid: ticket.channelid },
				});
				console.log(`Cleaned up orphaned ticket #${ticket.id} (channel ${ticket.channelid} no longer exists)`);
			}
		} catch {
			// Skip
		}
	}
}
