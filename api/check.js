const https = require('https');

export default async function handler(req, res) {
    const { dock, length, width, depth, arrival, departure } = req.query;

    const targetPath = `/en/docks/${dock}/availability?length=${length}&width=${width}&depth=${depth}&arrival=${arrival}&departure=${departure}`;

    const options = {
        hostname: 'www.dockspot.com',
        path: targetPath,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
                const spots = [];

                // 1. Matcha traditionella <option>-taggar (om de finns)
                const optionRegex = /<option[^>]*value=["']?([^"'>]+)["']?[^>]*>(.*?)<\/option>/gi;
                let match;
                while ((match = optionRegex.exec(data)) !== null) {
                    const value = match[1].trim();
                    const text = match[2].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
                    if (value && !value.toLowerCase().includes('select') && text.length > 0) {
                        spots.push(text);
                    }
                }

                // 2. Om inga <option> hittades, leta efter textmönster som innehåller plats och pris (t.ex. "Plats 12" eller "Spot 12 - 350 SEK")
                if (spots.length === 0) {
                    const spotTextRegex = /(?:Plats|Spot|Berth)\s*\d+[^<>\r\n]*/gi;
                    let textMatch;
                    while ((textMatch = spotTextRegex.exec(data)) !== null) {
                        const cleanText = textMatch[0].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
                        if (!spots.includes(cleanText)) {
                            spots.push(cleanText);
                        }
                    }
                }

                // 3. Om fortfarande inga platser hittades, leta efter JSON-data/objekt på sidan där platser är inbäddade
                if (spots.length === 0) {
                    const jsonSpotRegex = /"name"\s*:\s*"([^"]*(?:Plats|Spot|Berth)[^"]*)"/gi;
                    let jsonMatch;
                    while ((jsonMatch = jsonSpotRegex.exec(data)) !== null) {
                        if (!spots.includes(jsonMatch[1])) {
                            spots.push(jsonMatch[1]);
                        }
                    }
                }

                const isFull = spots.length === 0 && (data.includes("No available spots") || data.includes("Fully booked") || data.includes("Inga lediga platser"));

                res.status(200).json({
                    arrival,
                    departure,
                    available: spots.length > 0 || !isFull,
                    spots: spots
                });
                resolve();
            });
        });

        request.on('error', (error) => {
            res.status(200).json({
                arrival,
                departure,
                available: false,
                spots: [],
                error: error.message
            });
            resolve();
        });

        request.setTimeout(6000, () => {
            request.destroy();
            res.status(200).json({
                arrival,
                departure,
                available: false,
                spots: [],
                error: 'Timeout'
            });
            resolve();
        });

        request.end();
    });
}
