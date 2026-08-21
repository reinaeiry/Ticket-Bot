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

// Display name (TicketType.name, which is what older transcript rows stored in
// `transcripts.category`) -> codeName. Used only to backfill `category_code` on
// rows written before that column existed. Keep in sync with config.jsonc names.
const NAME_TO_CODE = {
	"NA1 Support": "na1-support",
	"NA2 Support": "na2-support",
	"NA3 Support": "na3-support",
	"EU1 Support": "eu1-support",
	"EU2 Support": "eu2-support",
	"EU3 Support": "eu3-support",
	"Ban Appeal": "ban-appeal",
	"GM Application": "gm-application",
	"Dev Application": "dev-application",
	"Shop Support": "shop-support",
	"Contact Management": "contact-management"
};

// Categories whose transcripts are sensitive. Mirrors the `isRestricted` test in
// src/utils/close.ts — if you add a category there, add it here.
const RESTRICTED_CODES = [
	"ban-appeal",
	"dev-application",
	"gm-application",
	"shop-support",
	"contact-management"
];

function codeForCategoryName(name) {
	if (typeof name !== "string") return null;
	return NAME_TO_CODE[name.trim()] || null;
}

function isRestrictedCode(codeName) {
	return RESTRICTED_CODES.indexOf(codeName) !== -1;
}

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

module.exports = {
	CODE_TO_PERM,
	PERM_TO_CODE,
	NAME_TO_CODE,
	RESTRICTED_CODES,
	permKeyForCode,
	codeNameForPerm,
	isSupportedCode,
	codeForCategoryName,
	isRestrictedCode
};
