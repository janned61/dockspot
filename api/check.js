const https = require('https');

export default async function handler(req, res) {
    const { dock, length, width, depth, arrival, departure } = req.query;

    const targetPath = `/sv/docks/${dock}?length=${length}&width=${width}&depth=${depth}&arrival=${arrival}&departure=${departure}`;

    const options = {
        hostname: 'www.dockspot.com',
        path: targetPath,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'no-cache'
        }
    };

    return new Promise((resolve) => {
        const request = https.request(options, (response) => {
            let data = '';

            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                let spots = [];

                // 1. Sök efter inbäddade platsnamn i JSON/skript (ex. "name":"Plats 12" eller "title":"A12")
                const jsonSpotRegex = /"(?:name|title|spot_name|spotNumber)"\s*:\s*"([^"]*(?:Plats|Spot|Berth|Brygga|\d+)[^"]*)"/gi;
                let jsonMatch;
                while ((jsonMatch = jsonSpotRegex.exec(data)) !== null) {
                    const spotName = jsonMatch[1].trim();
                    if (spotName && spotName.length < 30 && !spots.includes(spotName)) {
                        spots.push(spotName);
                    }
                }

                // 2. Sök efter <option>-taggar i formulär
                if (spots.length === 0) {
                    const optionRegex = /<option[^>]*value=["']?([^"'>]+)["']?[^>]*>(.*?)<\/option>/gi;
                    let optMatch;
                    while ((optMatch = optionRegex.exec(data)) !== null) {
                        const val = optMatch[1];
                        const txt = optMatch[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
                        if (val && !val.toLowerCase().includes('select') && txt && !txt.toLowerCase().includes('välj')) {
                            spots.push(txt);
                        }
                    }
                }

                // 3. Sök efter klassiska textmönster i HTML (t.ex. "Plats 14" eller "Spot 3")
                if (spots.length === 0) {
                    const textSpotRegex = /(?:Plats|Spot|Berth)\s*\d+[a-zA-Z]?/gi;
                    let textMatch;
                    while ((textMatch = textSpotRegex.exec(data)) !== null) {
                        if (!spots.includes(textMatch[0])) {
                            spots.push(textMatch[0]);
                        }
                    }
                }

                // Rensa dubletter
                spots = [...new Set(spots)];

                const isAvailable = spots.length > 0 || (!data.includes("No available spots") && !data.includes("Fullbokat") && !data.includes("Inga lediga platser"));

                res.status(200).json({
                    arrival,
                    departure,
                    available: isAvailable,
                    spots: spots
                });
                resolve();
            });
        });

        request.on('error', (error) => {
            res.status(200).json({ arrival, departure, available: false, spots: [], error: error.message });
            resolve();
        });

        // Sätt en timeout på 5 sekunder så att appen inte fastnar i "Laddar..."
        request.setTimeout(5000, () => {
            request.destroy();
            res.status(200).json({ arrival, departure, available: true, spots: [], timeout: true });
            resolve();
        });

        request.end();
    });
}
