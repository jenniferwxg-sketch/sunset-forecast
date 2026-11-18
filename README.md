# Afterglow

A sunrise and sunset forecast. Pick a place and it shows sunrise and sunset times, golden and blue hour, and a 0 to 100 score for how colorful the sky is likely to be, with a drawn preview of the likely look. It covers the next 7 days.

## How the score works

Sunset color comes from sunlight lighting clouds from below after a long, low path through the air. For the exact minute of each sunrise and sunset, the site reads the hourly forecast and checks:

- **Canvas:** high and mid cloud overhead. About 30 to 70% cover scores best.
- **Light path:** low cloud 100 and 250 km toward the sun, which can block the light. The site requests forecasts at those points along the sun's azimuth.
- **Air:** humidity, visibility and aerosol optical depth. Haze washes colors out; a little aerosol deepens reds.
- **Rain:** rain at the time lowers the score; rain clearing just before raises it.

The model lives in `js/score.js`. Sun times and positions are calculated in the browser with the NOAA solar position algorithm (`js/sun.js`). The sky preview is drawn on a canvas from the same numbers (`js/sky.js`).

## Data

Weather, geocoding and air quality come from [Open-Meteo](https://open-meteo.com/) (free, no API key, CC BY 4.0).

## Run locally

It's a static site with no build step:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy

GitHub Pages: Settings → Pages → Deploy from a branch → `main`, folder `/ (root)`.
