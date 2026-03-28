import { clobPriceHistoryAPI } from "./clobApi.js";

async function runClobFunc() {
	let marketId = "75922431214507703408436749060914922241512331397434519915305263983885215437544";
	let fidelity = 2;
	let eTs = Math.floor(Date.now() / 1000);
	let sTs = eTs - 2 * 24 * 60 * 60 ;
	await clobPriceHistoryAPI(marketId, sTs, eTs, fidelity);
}

await runClobFunc();
