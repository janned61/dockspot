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
        `/sv/docks/${dock}` +
        `?length=${length}` +
        `&width=${width}` +
        `&depth=${depth}` +
        `&arrival=${arrival}` +
        `&departure=${departure}`;

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
                let debug = {
                    htmlLength: data.length,
                    hasSpotsData: false,
                    foundJsonBlock: false,
                    firstSpot: null,
                    debugUrl:
                        `https://www.dockspot.com${targetPath}`,
                    sample: null
                };

                try {

                    const marker =
                        'data-bookings--spot-map-component-spots-value';

                    const markerPos =
                        data.indexOf(marker);

                    debug.hasSpotsData =
                        markerPos >= 0;

                    if (markerPos >= 0) {

                        const sampleStart =
                            Math.max(0, markerPos - 100);

                        const sampleEnd =
                            Math.min(
                                data.length,
                                markerPos + 500
                            );

                        debug.sample =
                            data.substring(
                                sampleStart,
                                sampleEnd
                            );

                    }

                    const jsonMatch = data.match(
                        /data-bookings--spot-map-component-spots-value="([^"]+)"/
                    );

                    if (jsonMatch) {

                        debug.foundJsonBlock = true;

                        const jsonText =
                            jsonMatch[1]
                                .replace(/&quot;/g, '"');

                        const spotData =
                            JSON.parse(jsonText);

                        if (
                            Array.isArray(spotData)
                            && spotData.length > 0
                        ) {

                            debug.firstSpot =
                                spotData[0];

                            spotData.forEach(
                                (spot) => {

                                    if (
                                        spot.isAvailable
