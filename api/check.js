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
      "Accept-Language": "en-US,en;q=0.9"
    }
  };

  const request = https.request(options, (response) => {

    let data = "";

    response.on("data", (chunk) => {
      data += chunk;
    });

    response.on("end", () => {

      let spots = [];

      try {

        const spotsMatch = data.match(
          /data-bookings--spot-map-component-spots-value="([^"]+)"/
        );

        if (spotsMatch) {

          const jsonText = spotsMatch[1]
            .replace(/&quot;/g, '"');

          const spotData = JSON.parse(jsonText);

          spotData.forEach((spot) => {

            if (spot.isAvailable === true) {
              spots.push(`Plats ${spot.number}`);
            }

          });

        }

        if (spots.length === 0) {

          const optionRegex =
            /<option[^>]*>(\d+)\s*\([^<]*<\/option>/g;

          let match;

          while ((match = optionRegex.exec(data)) !== null) {
            spots.push(`Plats ${match[1]}`);
          }

        }

        spots = [...new Set(spots)];

        res.status(200).json({
          arrival,
          departure,
          available: spots.length > 0,
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
