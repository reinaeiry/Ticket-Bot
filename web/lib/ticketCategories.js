// Mapping from the bot's TicketType.codeName (stored as JSON on
// tickets.category) -> the perm-key used by auth.reforgedz.net's
// `tickets` perm group. NA3 + EU3 + dev-app fallbacks are intentionally
// not in the perm grid; see the plan for why.

const CODE_TO_PERM = {
	"dev-application": "devApplications",
	"gm-application": "gmApplications",
	"ban-appeal": "banAppeals",
	"na1-support": "na1",
	"na2-support": "na2",
	"eu1-support": "eu1",
	"eu2-support": "eu2",
	"shop-support": "shopSupport",
	"contact-management": "managementSupport"
};

const PERM_TO_CODE = Object.fromEntries(
	Object.entries(CODE_TO_PERM).map(([code, perm]) => [perm, code])
);

function permKeyForCode(codeName) {
	return CODE_TO_PERM[codeName] || null;
}

function codeNameForPerm(permKey) {
	return PERM_TO_CODE[permKey] || null;
}

// All ticket type codeNames that map to one of our perm keys. Used to filter
// out NA3/EU3 (and any future categories) at the API boundary.
function isSupportedCode(codeName) {
	return Object.prototype.hasOwnProperty.call(CODE_TO_PERM, codeName);
}

module.exports = { CODE_TO_PERM, PERM_TO_CODE, permKeyForCode, codeNameForPerm, isSupportedCode };
