const INTERVAL_MS = 5_000;
const GSI_REVERSE_GEOCODER = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";
const GSI_MUNICIPALITIES = "https://maps.gsi.go.jp/js/muni.js";

const elements = {
  start: document.querySelector("#start"),
  welcome: document.querySelector("#welcome"),
  result: document.querySelector("#result"),
  status: document.querySelector("#status"),
  place: document.querySelector("#place"),
  accuracy: document.querySelector("#accuracy"),
  coordinates: document.querySelector("#coordinates"),
  updated: document.querySelector("#updated"),
  pulse: document.querySelector("#pulse"),
};

let timer = null;
let requestInFlight = false;
let municipalityNames = null;

function loadMunicipalities() {
  if (municipalityNames) return Promise.resolve(municipalityNames);

  return fetch(GSI_MUNICIPALITIES)
    .then((response) => {
      if (!response.ok) throw new Error("市区町村データを取得できませんでした");
      return response.text();
    })
    .then((source) => {
      const names = new Map();
      const pattern = /GSI\.MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']+)'/g;
      for (const match of source.matchAll(pattern)) {
        const [, code, value] = match;
        const [, prefecture, , municipality] = value.split(",");
        names.set(code, `${prefecture}${municipality}`);
      }
      municipalityNames = names;
      return names;
    });
}

async function reverseGeocode(latitude, longitude) {
  const url = new URL(GSI_REVERSE_GEOCODER);
  url.searchParams.set("lat", latitude);
  url.searchParams.set("lon", longitude);

  const [response, names] = await Promise.all([fetch(url), loadMunicipalities()]);
  if (!response.ok) throw new Error("地名を取得できませんでした");

  const data = await response.json();
  const result = data.results;
  if (!result) return "地名を特定できない場所";

  const municipality = names.get(String(result.muniCd)) ?? "";
  const locality = result.lv01Nm ?? "";
  return `${municipality}${locality}` || "地名を特定できない場所";
}

function getPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12_000,
      maximumAge: 0,
    });
  });
}

function positionErrorMessage(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "位置情報が許可されていません";
    case error.POSITION_UNAVAILABLE:
      return "GPSを受信できません";
    case error.TIMEOUT:
      return "GPSの取得に時間がかかっています";
    default:
      return "現在地を取得できませんでした";
  }
}

async function update() {
  if (requestInFlight) return;
  requestInFlight = true;
  elements.status.textContent = "現在地を取得中…";
  elements.status.classList.remove("error");

  try {
    const position = await getPosition();
    const { latitude, longitude, accuracy } = position.coords;

    elements.accuracy.textContent = `±${Math.round(accuracy)} m`;
    elements.coordinates.textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    elements.updated.textContent = `${new Date(position.timestamp).toLocaleTimeString("ja-JP")} 更新`;
    elements.pulse.classList.add("active");
    elements.status.textContent = "5秒ごとに計測中";

    try {
      elements.place.textContent = await reverseGeocode(latitude, longitude);
    } catch (error) {
      console.error(error);
      elements.place.textContent = "地名を取得できません";
    }
  } catch (error) {
    elements.status.textContent = positionErrorMessage(error);
    elements.status.classList.add("error");
    elements.updated.textContent = "再試行しています";
    elements.pulse.classList.remove("active");
  } finally {
    requestInFlight = false;
  }
}

function start() {
  if (!("geolocation" in navigator)) {
    elements.status.textContent = "この端末は位置情報に対応していません";
    elements.status.classList.add("error");
    return;
  }

  elements.welcome.hidden = true;
  elements.result.hidden = false;
  update();
  timer = window.setInterval(update, INTERVAL_MS);
}

elements.start.addEventListener("click", start, { once: true });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && timer) update();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
}
