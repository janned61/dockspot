const https = require('https');

export default async function handler(req, res) {
    const { dock, length, width, depth, arrival, departure } = req.query;

    // Extrahera hamnid/slug
    const dockSlug = dock.replace(/^\d+-/, ''); // e.g. "astol-gasthamn"

    // GraphQL-frågan som Dockspot använder internt
    const query = JSON.stringify({
        query: `
            query GetDockAvailability($slug: String!, $length: Float!, $width: Float!, $depth: Float!, $arrival: String!, $departure: String!) {
                dockBySlug(slug: $slug) {
                    id
                    name
                    availableSpots(length: $length, width: $width, depth: $depth, arrival: $arrival, departure: $departure) {
                        id
                        name
                        number
                        price
                    }
                }
            }
        `,
        variables: {
            slug: dockSlug,
            length: parseFloat(length),
            width: parseFloat(width),
            depth: parseFloat(depth),
            arrival: arrival,
            departure: departure
        }
    });

    const options = {
        hostname: 'www.dockspot.com',
        path: '/graphql',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(query),
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json'
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
                    const json = JSON.parse(data);
                    const rawSpots = json?.data?.dockBySlug?.availableSpots || [];
                    spots = rawSpots.map(s => s.name || s.number || `Plats ${s.id}`);
                } catch (e) {
                    // Om GraphQL misslyckas, gör en reservsökning via regex
                    const matches = data.match(/"name"\s*:\s*"([^"]+)"/g);
                    if (matches) {
                        spots = matches.map(m => m.replace(/"name"\s*:\s*"|"/g, ''));
                    }
                }

                // Ta bort dubletter
                spots = [...new Set(spots)];

                res.status(200).json({
                    arrival,
                    departure,
                    available: spots.length > 0,
                    spots: spots
                });
                resolve();
            });
        });

        request.on('error', (error) => {
            res.status(500).json({ arrival, departure, available: false, spots: [], error: error.message });
            resolve();
        });

        request.write(query);
        request.end();
    });
}
