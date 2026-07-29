(function () {
  "use strict";

  var CARS = [];
  var CARS_DIR = "cars/";
  var MAX_GUESSES = 5;
  var ZOOM_LEVELS = [4, 3, 2.2, 1.6, 1]; // scale applied before guess N (index 0 = before guess 1)
  var YEAR_CLOSE_RANGE = 3;
  var STORAGE_PREFIX = "carguesser:";

  var els = {
    photo: document.getElementById("car-photo"),
    photoLoading: document.getElementById("photo-loading"),
    guessCounter: document.getElementById("guess-counter"),
    form: document.getElementById("guess-form"),
    brandInput: document.getElementById("brand-input"),
    modelInput: document.getElementById("model-input"),
    yearInput: document.getElementById("year-input"),
    brandList: document.getElementById("brand-list"),
    modelList: document.getElementById("model-list"),
    submitBtn: document.getElementById("submit-guess"),
    history: document.getElementById("guess-history"),
    resultPanel: document.getElementById("result-panel"),
    resultTitle: document.getElementById("result-title"),
    resultDetail: document.getElementById("result-detail"),
    resultPhoto: document.getElementById("result-photo"),
    shareBtn: document.getElementById("share-btn"),
    countdown: document.getElementById("countdown"),
    howToBtn: document.getElementById("how-to-play-btn"),
    modal: document.getElementById("how-to-play-modal"),
    closeModal: document.getElementById("close-modal"),
  };

  function todayKey() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function getTodaysCar() {
    if (!CARS.length) return null;
    var key = todayKey();
    var idx = hashString(key) % CARS.length;
    return CARS[idx];
  }

  function normalize(str) {
    return String(str || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, "");
  }

  function loadState(car) {
    var raw = localStorage.getItem(STORAGE_PREFIX + todayKey());
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.carId === car.id) return parsed;
      } catch (e) {}
    }
    return { carId: car.id, guesses: [], status: "playing" };
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_PREFIX + todayKey(), JSON.stringify(state));
  }

  function populateBrandList() {
    var brands = Array.from(new Set(CARS.map(function (c) { return c.brand; }))).sort();
    els.brandList.innerHTML = brands.map(function (b) { return '<option value="' + b + '">'; }).join("");
  }

  function populateModelList(brandFilter) {
    var normBrand = normalize(brandFilter);
    var matchingCars = normBrand
      ? CARS.filter(function (c) { return normalize(c.brand).indexOf(normBrand) === 0; })
      : CARS;
    if (!matchingCars.length) matchingCars = CARS;
    var models = Array.from(new Set(matchingCars.map(function (c) { return c.model; }))).sort();
    els.modelList.innerHTML = models.map(function (m) { return '<option value="' + m + '">'; }).join("");
  }

  function applyZoom(guessNumber) {
    // guessNumber = number of guesses made so far (0 before any guess)
    var levelIdx = Math.min(guessNumber, ZOOM_LEVELS.length - 1);
    els.photo.style.transform = "scale(" + ZOOM_LEVELS[levelIdx] + ")";
  }

  function yearHint(guessYear, answerYear) {
    if (guessYear === answerYear) return { icon: "🟢", label: "Exact!", cls: "correct" };
    var diff = Math.abs(guessYear - answerYear);
    var arrow = guessYear < answerYear ? "⬆️" : "⬇️";
    if (diff <= YEAR_CLOSE_RANGE) {
      return { icon: "🟡 " + arrow, label: "Close (" + arrow + ")", cls: "close" };
    }
    return { icon: arrow, label: guessYear < answerYear ? "Higher" : "Lower", cls: "wrong" };
  }

  function renderHistory(state, car) {
    els.history.innerHTML = "";
    state.guesses.forEach(function (g, idx) {
      var isNew = idx === state.guesses.length - 1;

      var row = document.createElement("div");
      row.className = "guess-row" + (isNew ? " reveal" : "");

      function makeChip(text, icon, cls, delayIdx) {
        var chip = document.createElement("div");
        chip.className = "chip " + cls + (isNew ? " reveal" : "");
        if (isNew) chip.style.animationDelay = (delayIdx * 0.09) + "s";
        chip.innerHTML = "<span>" + text + "</span><span>" + icon + "</span>";
        return chip;
      }

      var brandChip = makeChip(g.brand, g.brandCorrect ? "✅" : "❌", g.brandCorrect ? "correct" : "wrong", 0);
      var modelChip = makeChip(g.model, g.modelCorrect ? "✅" : "❌", g.modelCorrect ? "correct" : "wrong", 1);
      var h = yearHint(g.year, car.year);
      var yearChip = makeChip(g.year, h.icon, h.cls, 2);

      row.appendChild(brandChip);
      row.appendChild(modelChip);
      row.appendChild(yearChip);
      els.history.appendChild(row);
    });
  }

  function updateCounter(state) {
    var remaining = MAX_GUESSES - state.guesses.length;
    if (state.status === "playing") {
      els.guessCounter.textContent = "Guess " + (state.guesses.length + 1) + " of " + MAX_GUESSES;
    } else {
      els.guessCounter.textContent = "Game over";
    }
  }

  function msUntilNextMidnight() {
    var now = new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return next - now;
  }

  function formatCountdown(ms) {
    var totalSec = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return "Next car in " + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  var countdownTimer = null;
  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    function tick() {
      els.countdown.textContent = formatCountdown(msUntilNextMidnight());
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function buildShareText(state, car, won) {
    var lines = ["🚗 Car Guesser — " + todayKey()];
    lines.push(won ? "Solved in " + state.guesses.length + "/" + MAX_GUESSES : "X/" + MAX_GUESSES);
    var rows = state.guesses.map(function (g) {
      var b = g.brandCorrect ? "🟩" : "⬜";
      var m = g.modelCorrect ? "🟩" : "⬜";
      var h = yearHint(g.year, car.year);
      var y = h.cls === "correct" ? "🟩" : h.cls === "close" ? "🟨" : "⬜";
      return b + m + y;
    });
    return lines.concat(rows).join("\n");
  }

  function finishGame(state, car, won) {
    state.status = won ? "won" : "lost";
    saveState(state);
    els.form.classList.add("hidden");
    els.resultPanel.classList.remove("hidden");
    els.photo.style.transform = "scale(1)";
    els.resultTitle.textContent = won ? "🎉 You got it!" : "😬 Out of guesses";
    els.resultDetail.textContent = car.brand + " " + car.model + " (" + car.year + ")";
    els.resultPhoto.src = car.imageUrl;
    startCountdown();

    els.shareBtn.onclick = function () {
      var text = buildShareText(state, car, won);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () {
          els.shareBtn.textContent = "✅ Copied!";
          setTimeout(function () { els.shareBtn.textContent = "📋 Copy Result"; }, 1800);
        });
      }
    };
  }

  function slugify(str) {
    return String(str)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function loadCars() {
    return fetch(CARS_DIR + "manifest.json")
      .then(function (res) { return res.json(); })
      .then(function (filenames) {
        return Promise.all(
          filenames.map(function (filename) {
            return fetch(CARS_DIR + filename).then(function (res) { return res.json(); });
          })
        );
      })
      .then(function (makeFiles) {
        var cars = [];
        makeFiles.forEach(function (file) {
          file.models.forEach(function (m) {
            cars.push({
              id: slugify(file.brand + "-" + m.model + "-" + m.year),
              brand: file.brand,
              model: m.model,
              year: m.year,
              imageUrl: m.imageUrl,
              sourcePage: m.sourcePage,
            });
          });
        });
        CARS = cars;
      });
  }

  function init() {
    var car = getTodaysCar();
    if (!car) {
      els.photoLoading.textContent = "No car data found. Check the cars/ folder and manifest.json.";
      return;
    }

    populateBrandList();
    populateModelList(els.brandInput.value);
    els.brandInput.addEventListener("input", function () {
      populateModelList(els.brandInput.value);
    });

    els.photo.src = car.imageUrl;
    els.photo.onload = function () {
      els.photoLoading.classList.add("hidden");
    };
    els.photo.onerror = function () {
      els.photoLoading.textContent = "Image failed to load.";
    };

    var state = loadState(car);
    applyZoom(state.guesses.length);
    renderHistory(state, car);
    updateCounter(state);

    if (state.status !== "playing") {
      finishGame(state, car, state.status === "won");
      return;
    }

    els.form.addEventListener("submit", function (e) {
      e.preventDefault();

      var brand = els.brandInput.value.trim();
      var model = els.modelInput.value.trim();
      var year = parseInt(els.yearInput.value, 10);

      if (!brand || !model || !year) return;

      var brandCorrect = normalize(brand) === normalize(car.brand);
      var modelCorrect = normalize(model) === normalize(car.model);
      var yearCorrect = year === car.year;

      state.guesses.push({
        brand: brand,
        model: model,
        year: year,
        brandCorrect: brandCorrect,
        modelCorrect: modelCorrect,
      });

      var won = brandCorrect && modelCorrect && yearCorrect;
      saveState(state);
      renderHistory(state, car);
      applyZoom(state.guesses.length);
      updateCounter(state);

      els.brandInput.value = "";
      els.modelInput.value = "";
      els.yearInput.value = "";
      populateModelList("");
      els.brandInput.focus();

      if (won || state.guesses.length >= MAX_GUESSES) {
        finishGame(state, car, won);
      }
    });
  }

  els.howToBtn.addEventListener("click", function () {
    els.modal.classList.remove("hidden");
  });
  els.closeModal.addEventListener("click", function () {
    els.modal.classList.add("hidden");
  });
  els.modal.addEventListener("click", function (e) {
    if (e.target === els.modal) els.modal.classList.add("hidden");
  });

  document.addEventListener("DOMContentLoaded", function () {
    loadCars()
      .then(init)
      .catch(function (err) {
        els.photoLoading.textContent = "Failed to load car data.";
        console.error(err);
      });
  });
})();
