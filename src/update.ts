import { Handler } from "@netlify/functions";
import fetch from "node-fetch";

const RATP_TRAFFIC = "https://api-ratp.pierre-grimaud.fr/v4/traffic"

const locations: {
	metros: { [key: string]: [number, number] },
	rers: { [key: string]: [number, number] },
} = {
	metros: {
		"1": [48.84493218959799, 2.3862429173449375],
		"2": [48.88505501204279, 2.3239843730983867],
		"3": [48.867890080953515, 2.330494282018371],
		"4": [48.845422492563465, 2.3244696797288666],
		"5": [48.880966468168815, 2.3699995103977454],
		"6": [48.83051004800357, 2.341097941350247],
		"7": [48.848797338954114, 2.351584364862548],
		"8": [48.85886438179252, 2.3035416708343432],
		"9": [48.84943379143096, 2.402041898908584],
		"10": [48.852654990079046, 2.2753974791092864],
		"11": [48.870238000728044, 2.3718699926160474],
		"12": [48.84835936364791, 2.321211617789586],
		"13": [48.892278215559024, 2.33326401748463],
		"14": [48.85918531670057, 2.352112378294355],
	},
	rers: {
		"A": [48.87309173229321, 2.299083136380106],
		"B": [48.872276521192575, 2.363288920627026],
		"C": [48.859315921993385, 2.3042283079863934],
		"D": [48.875564999456536, 2.338055188653638],
		"E": [48.88196661271685, 2.390265795015529],
	},
};

type Traffic = {
	line: string;
	slug: string;
	title: string;
	message: string;
};
type TrafficInfo = {
	result: {
		metros: Traffic[];
		rers: Traffic[];
		tramways: Traffic[];
	}
}
const getTrafficInfo = async (): Promise<TrafficInfo> => {
	const response = await fetch(RATP_TRAFFIC);
	return await response.json() as TrafficInfo;
}
const hasCurrentTrafficIssue = (traffic: Traffic): boolean => {
	if (["normal", "normal_trav"].includes(traffic.slug)) {
		return false;
	};

	const matches = traffic.message.match(/\d\dh\d\d/i);

	if (!matches) {
		return false;
	}

	const sixteenMinutesAgo = new Date().getTime() - (16 * 60 * 1000) + (60 * 60 * 1000);
	return matches.every(match => {
		const [hours, minutes] = match.split("h");

		const date = new Date(new Date().setHours(+hours)).setMinutes(+minutes);

		return date > sixteenMinutesAgo;
	});
}

type ZiggPost = {
	text: string,
	duration: number | null,
  latitude: number,
  longitude: number,
	tag: string | null,
  place_name: string
  medias: string[]
}

const trafficIssue = {
	metro: {
		name: (traffic: Traffic): string => `Métro ${traffic.line}`,
		tag: "Métro",
		locations: locations.metros,
	},
	rer: {
		name: (traffic: Traffic): string => `RER ${traffic.line}`,
		tag: "RER",
		locations: locations.rers,
	},
} as const;
const parseTrafficIssue = (type: keyof typeof trafficIssue): (traffic: Traffic) => ZiggPost => (traffic: Traffic): ZiggPost => {
	return {
		text: `[${trafficIssue[type].name(traffic)} - ${traffic.title}] ${traffic.message}`,
		duration: 1,
		latitude: trafficIssue[type].locations[traffic.line][0],
		longitude: trafficIssue[type].locations[traffic.line][1],
		tag: trafficIssue[type].tag,
		place_name: trafficIssue[type].name(traffic),
		medias: [],
	}
}

const handler: Handler = async (event, context) => {
	// 1. Get current traffic
	const traffic = await getTrafficInfo();

	// 2. Parse data
	const issues = [
		...traffic.result.metros.filter(hasCurrentTrafficIssue).map(parseTrafficIssue("metro")),
		...traffic.result.rers.filter(hasCurrentTrafficIssue).map(parseTrafficIssue("rer"))
	];

	console.log(issues);

	// 3. Get Zigg bearer
	const ziggBearer = (await (await fetch(`https://api.zigg.app/auth?apikey=${process.env.ZIGG_TOKEN}`)).json()) as {
		token_type: "bearer";
		access_token: string;
	};

	// 4. Post to Zigg
	const promises = issues.map(issue => {
		return fetch(`https://api.zigg.app/communities/ratp/posts`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${ziggBearer.access_token}`,
			},
			body: JSON.stringify(issue),
		})
	});

	try {
		await Promise.all(promises);
	} catch (error) {
		console.log(error)
	}

	// Sleep 1 second
	await new Promise(resolve => setTimeout(resolve, 1000));

  return { statusCode: 200 };
};

export { handler };
