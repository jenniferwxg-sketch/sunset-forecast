# Glowcast

A sunrise and sunset forecast. Pick a place and it shows sunrise and sunset times, golden and blue hour, and a 0 to 100 score for how colorful the sky is likely to be, with a drawn preview of the likely look. It covers the next 7 days.

## How the score works

Sunset color comes from sunlight lighting clouds from below after a long, low path through the air. For the exact minute of each sunrise and sunset, the site reads the hourly forecast and checks:

- **Canvas:** high and mid cloud overhead. About 30 to 70% cover scores best.
- **Light path:** low cloud 60, 150 and 300 km toward the sun, which can block the light. The site requests forecasts at those points along the sun's azimuth.
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

## Weather models

Each forecast is scored with four models from Open-Meteo: ECMWF IFS (Europe), GFS (United States), ICON (Germany) and GEM (Canada, using the 2.5 km HRDPS over North America). The site shows the median score and lowers confidence when the models disagree. If the multi-model request fails, it falls back to Open-Meteo's default model.

## Accuracy

Sun times are accurate to about 2 minutes. The color score is roughly right 2 times out of 3 for the next day and about 4 in 10 at 4+ days. The sky picture is an illustration of the forecast, not a photo.
