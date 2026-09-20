export default async function handler(req, res) {
    const { dock, length, width, depth, arrival, departure } = req.query;

    const url = `https://www.dockspot.com/en/docks/${dock}/availability?length=${length}&width=${width}&depth=${depth}&arrival=${arrival}&departure=${departure}`;

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ available: false, error: 'Dockspot svarade inte' });
        }

        const html = await response.text();
        
        // Kollar om sidan saknar indikationer på "fullbokat"
        const isFull = html.includes("No available spots") || html.includes("Fully booked") || html.includes("Inga lediga platser");

        return res.status(200).json({
            arrival,
            departure,
            available: !isFull
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
