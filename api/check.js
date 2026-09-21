const https = require('https');

export default async function handler(req, res) {

    const {
        dock,
        length,
        width,
        depth,
        arrival,
        departure
    } = req.query;

    const targetPath =
        `/sv/docks/${dock}/spot_selections/new` +
        `?length=${length}` +
        `&width=${width}` +
        `&depth=${depth}` +
        `&from=${arrival}` +
        `&to=${departure}`;

    const options = {
        hostname: 'www.dockspot.com',
        path: targetPath,
        method: 'GET',
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
            'Accept':
                'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language':
                'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
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

                try {

                    //
                    // 1. Hämta spots från Dockspots JSON
                    //
                    const jsonMatch = data.match(
                        /data-bookings--spot-map-component-spots-value="([^"]+)"/
                    );

                    if (jsonMatch) {

                        const jsonText = jsonMatch[1]
                            .replace(/&quot;/g, '"');

                        const spotData = JSON.parse(jsonText);

                        spotData.forEach(spot => {

                            if (spot.isAvailable) {

                                spots.push(
                                    `Plats ${spot.number}`
                                );

                            }

                        });

                    }

                } catch (err) {

                    console.log(
                        'Fel vid parsning av spots-value:',
                        err.message
                    );

                }

                //
                // 2. Fallback via dropdown-listan
                //
                if (spots.length === 0) {

                    const optionRegex =
                        /<option[^>]*value="(\d+)"[^>]*>(\d+)\s*\(/g;

                    let match;

                    while ((match = optionRegex.exec(data)) !== null) {

                        spots.push(
                            `Plats ${match[2]}`
                        );

                    }

                }

                //
                // 3. Ta bort dubletter
                //
                spots = [...new Set(spots)];

                //
                // 4. Tillgänglighet
                //
                const available = spots.length > 0;

                res.status(200).json({
                    arrival,
                    departure,
                    available,
                    spots,
                    count: spots.length
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

        request.setTimeout(15000, () => {

            request.destroy();

            res.status(200).json({
                arrival,
                departure,
                available: false,
                spots: [],
                error: 'timeout'
            });

            resolve();

        });

        request.end();

    });

}
