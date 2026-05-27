// Posts audit events to auth.reforgedz.net /api/internal/audit so admin
// activity on transcripts.reforgedz.net (viewing transcripts, browsing the
// admin table) lands in the same central audit log as everything else.
//
// Lazy env reads + view dedupe mirror the admin server's bmAudit.js.

function authBase() { return (process.env.AUTH_BASE || "https://auth.reforgedz.net").replace(/\/+$/, ""); }
function auditKey() { return process.env.INTERNAL_AUDIT_KEY || ""; }

function ctxFromReq(req) {
	const ip = (req.headers["cf-connecting-ip"] || req.ip || "").toString().replace(/^::ffff:/, "");
	return { ip, ua: req.headers["user-agent"] || "" };
}

async function postAuditEvent({ actorUsername, action, targetUsername, detail, ctx }) {
	const key = auditKey();
	if (!key) return; // not configured — silently skip
	const payload = {
		actorUsername: actorUsername || null,
		action,
		targetUsername: targetUsername || null,
		detail: detail || null,
		ip: ctx?.ip || null,
		ua: ctx?.ua || null
	};
	try {
		const res = await fetch(`${authBase()}/api/internal/audit`, {
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
		if (!res.ok) {
			const t = await res.text().catch(() => "");
			console.warn(`[authAudit] ${res.status}: ${t.slice(0, 160)}`);
		}
	} catch (err) {
		console.warn("[authAudit] post failed:", err.message);
	}
}

// Deduped view auditing — collapse repeat views of the same target by the
// same actor within a 5-minute window.
const VIEW_DEDUPE_MS = 5 * 60 * 1000;
const recent = new Map();

function auditView(req, action, target = "", detail = null) {
	const actor = req.rzUser?.username;
	if (!actor) return; // only audit logged-in admins, not public share-link views
	const k = `${actor}|${action}|${target}`;
	const now = Date.now();
	const hit = recent.get(k);
	if (hit && hit > now) return;
	recent.set(k, now + VIEW_DEDUPE_MS);
	if (recent.size > 5000) for (const [kk, exp] of recent) if (exp < now) recent.delete(kk);
	postAuditEvent({ actorUsername: actor, action, detail: { target: target || undefined, ...(detail || {}) }, ctx: ctxFromReq(req) });
}

module.exports = { postAuditEvent, auditView, ctxFromReq };
