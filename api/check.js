const https = require('https');

export default async function handler(req, res) {
    const { dock, length, width, depth, arrival, departure } = req.query;

    // Hämta hamn-ID från dock-strängen (t.ex. "142" från "142-astol-gasthamn")
    const dockId = dock.split('-')[0];

    // Dockspots interna API-sökväg för sökning
    const targetPath = `/api/v1/docks/${dockId}/availability?length=${length}&width=${width}&depth=${depth}&arrival=${arrival}&departure=${departure}`;

    const options = {
        hostname: 'www.dockspot.com',
        path: targetPath,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': `https://www.dockspot.com/sv/docks/${dock}`,
            'X-Requested-With': 'XMLHttpRequest'
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
                let isAvailable = false;

                try {
                    const json = JSON.parse(data);
                    
                    // Om API:et returnerar en lista med platser
                    if (Array.isArray(json)) {
                        spots = json.map(s => `${s.name || s.title || 'Plats ' + s.id} - ${s.price || ''} ${s.currency || 'SEK'}`.trim());
                    } else if (json.spots) {
                        spots = json.spots.map(s => `${s.name || s.title} - ${s.price || ''} ${s.currency || 'SEK'}`.trim());
                    }
                    
                    isAvailable = spots.length > 0;
                } catch (e) {
                    // Om API-anropet inte gav JSON, fall tillbaka på enkel status
                    isAvailable = !data.includes("No available spots") && !data.includes("Fullbokat");
                }

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

        request.end();
    });
}
