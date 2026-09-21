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

      const spotsAttribute =
        data.match(
          /data-bookings--spot-map-component-spots-value="([^"]*)"/
        );

      const bookingSelect =
        data.match(
          /<select[^>]*booking\[spot_id\][\s\S]*?<\/select>/i
        );

      const optionMatches =
        [...data.matchAll(
          /<option[^>]*>(.*?)<\/option>/gi
        )].map(m => m[1]);

      console.log("====================================");
      console.log("URL:");
      console.log(targetPath);

      console.log("====================================");
      console.log("HTTP STATUS:");
      console.log(response.statusCode);

      console.log("====================================");
      console.log("SPOTS ATTRIBUTE:");

      if (spotsAttribute) {
        console.log(
          spotsAttribute[1].substring(0, 2000)
        );
      } else {
        console.log("EJ HITTAD");
      }

      console.log("====================================");
      console.log("BOOKING SELECT:");

      if (bookingSelect) {
        console.log(
          bookingSelect[0].substring(0, 5000)
        );
      } else {
        console.log("EJ HITTAD");
      }

      console.log("====================================");
      console.log("OPTIONS:");

      console.log(optionMatches);

      console.log("====================================");
      console.log("NO SINGLE BERTH:");

      console.log(
        data.includes("No single berth available")
      );

      console.log("====================================");
      console.log("HTML LENGTH:");

      console.log(data.length);

      console.log("====================================");

      res.status(200).json({

        debug: true,

        url: targetPath,

        statusCode: response.statusCode,

        htmlLength: data.length,

        foundSpotsAttribute: !!spotsAttribute,

        spotsAttributePreview:
          spotsAttribute
            ? spotsAttribute[1].substring(0, 500)
            : null,

        foundBookingSelect: !!bookingSelect,

        optionCount: optionMatches.length,

        options: optionMatches.slice(0, 50),

        noSingleBerth:
          data.includes("No single berth available"),

        containsMapComponent:
          data.includes(
            "data-bookings--spot-map-component"
          ),

        containsSpotId:
          data.includes(
            "booking[spot_id]"
          )

      });

    });

  });

  request.on("error", (err) => {

    res.status(200).json({
      error: err.message
    });

  });

  request.setTimeout(15000, () => {

    request.destroy();

    res.status(200).json({
      error: "timeout"
    });

  });

  request.end();

};
