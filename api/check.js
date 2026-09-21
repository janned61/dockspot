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
                let spots = [];

                // 1. Försök hitta Next.js / React hydration JSON
                const nextDataMatch = data.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
                if (nextDataMatch) {
                    try {
                        const json = JSON.parse(nextDataMatch[1]);
                        // Traversera JSON för att hitta platser
                        const pageProps = json.props?.pageProps || {};
                        const spotsData = pageProps.spots || pageProps.dock?.spots || pageProps.availability || [];
                        
                        if (Array.isArray(spotsData)) {
                            spots = spotsData.map(s => s.name || s.title || `Plats ${s.spot_number || s.id}`).filter(Boolean);
                        }
                    } catch (e) {
                        // ignore json parse error
                    }
                }

                // 2. Om __NEXT_DATA__ inte gav träff, sök efter generella spot-mönster i JS/JSON på sidan
                if (spots.length === 0) {
                    const spotNameRegex = /"name"\s*:\s*"([^"]*(?:Plats|Spot|Berth|Brygga)[^"]*)"/gi;
                    let m;
                    while ((m = spotNameRegex.exec(data)) !== null) {
                        if (!spots.includes(m[1])) {
                            spots.push(m[1]);
                        }
                    }
                }

                // 3. Om fortfarande inga, sök efter <option>-taggar eller data-attributes
                if (spots.length === 0) {
                    const optionRegex = /<option[^>]*>(.*?)<\/option>/gi;
                    let optMatch;
                    while ((optMatch = optionRegex.exec(data)) !== null) {
                        const txt = optMatch[1].replace(/<[^>]+>/g, '').trim();
                        if (txt && !txt.toLowerCase().includes('select') && !txt.toLowerCase().includes('välj') && txt.length < 30) {
                            spots.push(txt);
                        }
                    }
                }

                // Ta bort dubletter
                spots = [...new Set(spots)];

                const isFull = spots.length === 0 && (data.includes("No available spots") || data.includes("Fullbokat") || data.includes("Inga lediga platser"));

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
            res.status(500).json({ available: false, spots: [], error: error.message });
            resolve();
        });

        request.end();
    });
}
