const https = require("https");

module.exports = async function handler(req, res) {

  const {
    dock,
    length,
    width,
    depth,
    arrival,
    departure
  } = req.query;

  const targetPath =
    `/en/docks/${dock}/spot_selections/new` +
    `?length=${length}` +
    `&width=${width}` +
    `&depth=${depth}` +
    `&from=${arrival}` +
    `&to=${departure}`;

  const options = {
    hostname: "www.dockspot.com",
    path: targetPath,
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache"
    }
  };

  const request = https.request(options, (response) => {

    let data = "";

    response.on("data", (chunk) => {
      data += chunk;
    });

    response.on("end", () => {

      try {

        let spots = [];

        //
        // METOD 1
        // Läs JSON-attributet
        //
        const spotsMatch = data.match(
          /data-bookings--spot-map-component-spots-value="([^"]*)"/
        );

        if (spotsMatch && spotsMatch[1] !== "[]") {

          try {

            const jsonText = spotsMatch[1]
              .replace(/&quot;/g, '"');

            const spotData = JSON.parse(jsonText);

            spotData.forEach((spot) => {

              if (
                spot.number &&
                spot.isAvailable === true
              ) {
                spots.push(`Plats ${spot.number}`);
              }

            });

          } catch (e) {
            console.log("JSON parse error:", e.message);
          }
        }

        //
        // METOD 2
        // Läs dropdown-listan
        //
        if (spots.length === 0) {

          const optionRegex =
            /<option[^>]*value="[^"]*"[^>]*>(\d+)\s*\([^<]*<\/option>/gi;

          let match;

          while ((match = optionRegex.exec(data)) !== null) {

            spots.push(`Plats ${match[1]}`);

          }
        }

        //
        // METOD 3
        // Fallback
        //
        if (spots.length === 0) {

          const berthRegex =
            />(\d+)\s*\(\d+\.\d+\s*SEK\s*for\s*\d+\s*night/gi;

          let match;

          while ((match = berthRegex.exec(data)) !== null) {

            spots.push(`Plats ${match[1]}`);

          }
        }

        spots = [...new Set(spots)];

        const available =
          spots.length > 0 &&
          !data.includes("No single berth available");

        res.status(200).json({
          arrival,
          departure,
          available,
          count: spots.length,
          spots
        });

      } catch (err) {

        res.status(200).json({
          arrival,
          departure,
          available: false,
          spots: [],
          error: err.message
        });

      }

    });

  });

  request.on("error", (err) => {

    res.status(200).json({
      arrival,
      departure,
      available: false,
      spots: [],
      error: err.message
    });

  });

  request.setTimeout(15000, () => {

    request.destroy();

    res.status(200).json({
      arrival,
      departure,
      available: false,
      spots: [],
      error: "timeout"
    });

  });

  request.end();

};
