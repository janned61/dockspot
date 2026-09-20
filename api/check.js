const https = require('https');

export default async function handler(req, res) {
    const { dock, length, width, depth, arrival, departure } = req.query;

    // Vi anropar Dockspots interna tillgänglighets-URL
    const targetPath = `/en/docks/${dock}/availability?length=${length}&width=${width}&depth=${depth}&arrival=${arrival}&departure=${departure}`;

    const options = {
        hostname: 'www.dockspot.com',
        path: targetPath,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
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
                let debugRaw = '';

                // Försök tolka om svaret är ren JSON
                try {
                    const parsed = JSON.parse(data);
                    if (Array.isArray(parsed)) {
                        spots = parsed.map(s => s.name || s.title || s.spot_number || JSON.stringify(s));
                    } else if (parsed.spots || parsed.docks) {
                        const list = parsed.spots || parsed.docks;
                        spots = list.map(s => s.name || s.title || JSON.stringify(s));
                    }
                } catch (e) {
                    // Om det är HTML, extrahera alla id/namn eller kända nycklar
                    debugRaw = data.substring(0, 300); // Sparar första 300 tecknen för analys
                    
                    const spotMatches = data.match(/data-spot-name=["']([^"']+)["']/g) || 
                                       data.match(/data-name=["']([^"']+)["']/g) ||
                                       data.match(/"name"\s*:\s*"([^"]+)"/g);

                    if (spotMatches) {
                        spots = spotMatches.map(m => m.replace(/data-spot-name=|data-name=|"name"\s*:\s*|["']/g, '').trim());
                    }
                }

                // Ta bort dubletter
                spots = [...new Set(spots)];

                res.status(200).json({
                    arrival,
                    departure,
                    available: spots.length > 0 || !data.includes("No available spots"),
                    spots: spots,
                    debugRaw: spots.length === 0 ? debugRaw : null
                });
                resolve();
            });
        });

        request.on('error', (error) => {
            res.status(200).json({ arrival, departure, available: false, spots: [], error: error.message });
            resolve();
        });

        request.end();
    });
}
