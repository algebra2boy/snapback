async function clobPriceHistoryAPI(conditionId, sTs, eTs, fidelity) {
	// Use the parameters to get the information
	const CLOB_BASE = "https://clob.polymarket.com/prices-history";
	// Build API Str
	let apiStr = `${CLOB_BASE}?market=${conditionId}`;
	apiStr = `${apiStr}&startTs=${sTs}&endTs=${eTs}`;
	apiStr = `${apiStr}&fidelity=${fidelity}`;
	// Send HTTP Req and parse Res
	let res = await fetch(apiStr);
	let json = await res.json();
	console.log(apiStr);
	// Just print json for now...
	console.log(json);
	// TODO: Adjust according to schema
}

export { clobPriceHistoryAPI }
