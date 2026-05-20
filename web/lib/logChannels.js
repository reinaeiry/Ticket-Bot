// Discord channel -> log type/region/server mapping. N3 servers have no logs.
const LOG_CHANNELS = {
	// NA
	"1413566834296356884": { type: "anticheat", region: "NA", server: null },
	"1478166791766147214": { type: "shop",      region: "NA", server: null },
	"1374595329751781416": { type: "kill",      region: "NA", server: "NA1" },
	"1374600376627626026": { type: "chat",      region: "NA", server: "NA1" },
	"1476017130146103476": { type: "kill",      region: "NA", server: "NA2" },
	"1476017649237495919": { type: "chat",      region: "NA", server: "NA2" },
	// EU
	"1413567007001022636": { type: "anticheat", region: "EU", server: null },
	"1478167292201406586": { type: "shop",      region: "EU", server: null },
	"1375196600065851535": { type: "kill",      region: "EU", server: "EU1" },
	"1375196707465199756": { type: "chat",      region: "EU", server: "EU1" },
	"1476019394495778866": { type: "kill",      region: "EU", server: "EU2" },
	"1476019707189399654": { type: "chat",      region: "EU", server: "EU2" },
	// Global
	"1487213456955543703": { type: "base",      region: "ALL", server: null }
};

const LOG_CHANNEL_IDS = Object.keys(LOG_CHANNELS);

module.exports = { LOG_CHANNELS, LOG_CHANNEL_IDS };
