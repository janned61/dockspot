import https from "https";

function fetchPage(path, redirects = 0) {

    return new Promise((resolve, reject) => {

        const options = {
            hostname: "www.dockspot.com",
            path,
            method: "GET",
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
                "Accept":
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language":
                    "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7"
            }
        };

        https.get(options, (response) => {

            // Följ redirect
            if (
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                response.headers.location
            ) {

                if (redirects > 5) {
                    reject(
                        new Error("För många redirects")
                    );
                    return;
                }

                let nextPath =
                    response.headers.location;

                if (
                    nextPath.startsWith(
                        "https://www.dockspot.com"
                    )
                ) {

                    nextPath = nextPath.replace(
                        "https://www.dockspot.com",
                        ""
                    );

                }

                resolve(
                    fetchPage(
                        nextPath,
                        redirects + 1
                    )
                );

                return;
            }

            let data = "";

            response.on(
                "data",
                chunk => {
                    data += chunk;
                }
            );

            response.on(
                "end",
                () => {

                    resolve({
                        html: data,
                        statusCode:
                            response.statusCode
                    });

                }
            );

        }).on("error", reject);

    });

}

export default async function handler(req, res) {

    try {

        const {
            dock,
            length,
            width,
            depth,
            arrival,
            departure
        } = req.query;

        const path =
            `/en/docks/${dock}/spot_selections/new` +
            `?length=${length}` +
            `&width=${width}` +
            `&depth=${depth}` +
            `&from=${arrival}` +
            `&to=${departure}`;

        const result =
            await fetchPage(path);

        const html =
            result.html || "";

        let spots = [];

        //
        // Primär metod
        //

        const match = html.match(
            /data-bookings--spot-map-component-spots-value="([^"]+)"/
        );

        if (match) {

            try {

                const jsonText =
                    match[1]
                        .replace(
                            /&quot;/g,
                            '"'
                        );

                const spotData =
                    JSON.parse(jsonText);

                spotData.forEach(
                    spot => {

                        if (
                            spot.isAvailable
                        ) {

                            spots.push(
                                `Plats ${spot.number}`
                            );

                        }

                    }
                );

            } catch (e) {

                console.log(
                    "JSON parse error:",
                    e.message
                );

            }
        }

        //
        // Fallback
        //

        if (
            spots.length === 0
        ) {

            const optionRegex =
                /<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/g;

            let found;

            while (
                (found =
                    optionRegex.exec(
                        html
                    )) !== null
            ) {

                const text =
                    found[2].trim();

                if (
                    /^\d+/.test(text)
                ) {

                    spots.push(
                        `Plats ${
                            text.split(" ")[0]
                        }`
                    );

                }

            }
        }

        spots =
            [...new Set(spots)];

        res.status(200).json({

            arrival,
            departure,

            available:
                spots.length > 0,

            count:
                spots.length,

            spots,

            debug: {
                url: path,
                statusCode:
                    result.statusCode,
                htmlLength:
                    html.length,
                containsSpotsValue:
                    html.includes(
                        "data-bookings--spot-map-component-spots-value"
                    ),
                containsBookingSelect:
                    html.includes(
                        "booking_spot_id"
                    )
            }

        });

    } catch (err) {

        res.status(200).json({

            available: false,
            count: 0,
            spots: [],

            error:
                err.message

        });

    }

}
