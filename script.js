(function () {
  "use strict";

  var CARS = [];
  var CARS_DIR = "cars/";
  var MAX_GUESSES = 5;
  var ZOOM_LEVELS = [4, 3, 2.2, 1.6, 1]; // scale applied before guess N (index 0 = before guess 1)
  var FOCAL_LENGTHS = [400, 320, 240, 160, 85]; // mm readout paired with ZOOM_LEVELS
  var YEAR_CLOSE_RANGE = 3;
  var STORAGE_PREFIX = "carguesser:";
  var COMBO_MAX_RESULTS = 8;

  var els = {
    photoFrame: document.getElementById("photo-frame"),
    photo: document.getElementById("car-photo"),
    photoLoading: document.getElementById("photo-loading"),
    shutterFlash: document.getElementById("shutter-flash"),
    exifFocal: document.getElementById("exif-focal"),
    exifStatus: document.getElementById("exif-status"),
    guessCounter: document.getElementById("guess-counter"),
    sightingDots: document.getElementById("sighting-dots"),
    caseNoValue: document.getElementById("case-no-value"),
    form: document.getElementById("guess-form"),
    brandInput: document.getElementById("brand-input"),
    modelInput: document.getElementById("model-input"),
    yearInput: document.getElementById("year-input"),
    brandList: document.getElementById("brand-combo-list"),
    modelList: document.getElementById("model-combo-list"),
    submitBtn: document.getElementById("submit-guess"),
    history: document.getElementById("guess-history"),
    resultPanel: document.getElementById("result-panel"),
    resultStamp: document.getElementById("result-stamp"),
    resultDetail: document.getElementById("result-detail"),
    resultPhoto: document.getElementById("result-photo"),
    shareBtn: document.getElementById("share-btn"),
    countdown: document.getElementById("countdown"),
    howToBtn: document.getElementById("how-to-play-btn"),
    modal: document.getElementById("how-to-play-modal"),
    closeModal: document.getElementById("close-modal"),
  };

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function todayKey() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function dayOfYear() {
    var d = new Date();
    var start = new Date(d.getFullYear(), 0, 0);
    var diff = d - start;
    return Math.floor(diff / 86400000);
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

  /* ---------------- Custom combo (autocomplete) ---------------- */

  function createCombo(input, listEl, getOptions, onSelect) {
    var activeIndex = -1;
    var currentOptions = [];
    var suppressNextFocusOpen = false;

    function render(options) {
      currentOptions = options;
      activeIndex = options.length ? 0 : -1;
      listEl.innerHTML = "";
      options.forEach(function (opt, i) {
        var li = document.createElement("li");
        li.className = "combo-option" + (i === activeIndex ? " active" : "");
        li.setAttribute("role", "option");
        li.id = listEl.id + "-opt-" + i;
        li.style.animationDelay = i * 0.02 + "s";
        li.textContent = opt;
        li.addEventListener("mousedown", function (e) {
          e.preventDefault();
          select(opt, li);
        });
        li.addEventListener("mouseenter", function () {
          setActive(i);
        });
        listEl.appendChild(li);
      });
      listEl.hidden = options.length === 0;
      input.setAttribute("aria-expanded", options.length ? "true" : "false");
    }

    function setActive(i) {
      activeIndex = i;
      Array.prototype.forEach.call(listEl.children, function (li, idx) {
        li.classList.toggle("active", idx === i);
      });
      var activeEl = listEl.children[i];
      if (activeEl) input.setAttribute("aria-activedescendant", activeEl.id);
    }

    function close() {
      listEl.hidden = true;
      input.setAttribute("aria-expanded", "false");
    }

    function select(value, li) {
      if (li && !prefersReducedMotion()) {
        li.classList.add("snap");
        setTimeout(function () {
          input.value = value;
          close();
          onSelect(value);
          input.focus();
        }, 150);
      } else {
        input.value = value;
        close();
        onSelect(value);
        input.focus();
      }
    }

    input.addEventListener("input", function () {
      render(getOptions(input.value));
      onSelect(null, true); // typing without a confirmed selection
    });

    input.addEventListener("focus", function () {
      if (suppressNextFocusOpen) {
        suppressNextFocusOpen = false;
        return;
      }
      render(getOptions(input.value));
    });

    input.addEventListener("keydown", function (e) {
      if (listEl.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        render(getOptions(input.value));
        return;
      }
      if (listEl.hidden) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive(Math.min(activeIndex + 1, currentOptions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(Math.max(activeIndex - 1, 0));
      } else if (e.key === "Enter") {
        if (activeIndex >= 0 && currentOptions[activeIndex]) {
          e.preventDefault();
          select(currentOptions[activeIndex], listEl.children[activeIndex]);
        }
      } else if (e.key === "Escape") {
        close();
      }
    });

    document.addEventListener("click", function (e) {
      if (!input.contains(e.target) && !listEl.contains(e.target)) close();
    });

    return {
      close: close,
      refresh: function () { render(getOptions(input.value)); },
      suppressNextFocusOpen: function () { suppressNextFocusOpen = true; },
    };
  }

  function filterOptions(all, query) {
    var norm = normalize(query);
    if (!norm) return all.slice(0, COMBO_MAX_RESULTS);
    var startsWith = [];
    var contains = [];
    all.forEach(function (opt) {
      var n = normalize(opt);
      if (n.indexOf(norm) === 0) startsWith.push(opt);
      else if (n.indexOf(norm) !== -1) contains.push(opt);
    });
    return startsWith.concat(contains).slice(0, COMBO_MAX_RESULTS);
  }

  function setLockState(input, isLocked) {
    input.classList.toggle("locked-in", isLocked);
  }

  /* ---------------- Visual feedback helpers ---------------- */

  function applyZoom(guessNumber) {
    var levelIdx = Math.min(guessNumber, ZOOM_LEVELS.length - 1);
    var reduced = prefersReducedMotion();

    if (!reduced) {
      els.photoFrame.classList.add("racking");
      setTimeout(function () {
        els.photoFrame.classList.remove("racking");
      }, 500);
    }

    els.photo.style.transform = "scale(" + ZOOM_LEVELS[levelIdx] + ")";
    els.exifFocal.textContent = FOCAL_LENGTHS[levelIdx] + "mm";
  }

  function fireShutter() {
    if (prefersReducedMotion()) return;
    els.shutterFlash.classList.remove("firing");
    void els.shutterFlash.offsetWidth; // restart animation
    els.shutterFlash.classList.add("firing");
  }

  function renderDots(state) {
    els.sightingDots.innerHTML = "";
    for (var i = 0; i < MAX_GUESSES; i++) {
      var dot = document.createElement("span");
      var spent = i < state.guesses.length;
      dot.className = "dot" + (spent ? " spent" : "");
      if (spent && i === state.guesses.length - 1 && state._animateLast && !prefersReducedMotion()) {
        dot.classList.add("pop");
      }
      els.sightingDots.appendChild(dot);
    }
  }

  /* ---------------- Game data helpers ---------------- */

  function yearHint(guessYear, answerYear) {
    if (guessYear === answerYear) return { mark: "●", label: "Exact", cls: "correct" };
    var diff = Math.abs(guessYear - answerYear);
    var arrow = guessYear < answerYear ? "▲" : "▼";
    if (diff <= YEAR_CLOSE_RANGE) {
      return { mark: arrow, label: "Close", cls: "close" };
    }
    return { mark: arrow, label: guessYear < answerYear ? "Too early" : "Too late", cls: "wrong" };
  }

  function renderHistory(state, car) {
    els.history.innerHTML = "";
    state.guesses.forEach(function (g, idx) {
      var isNew = idx === state.guesses.length - 1 && state._animateLast;

      var slip = document.createElement("div");
      var anyCorrect = g.brandCorrect || g.modelCorrect;
      slip.className = "slip" + (anyCorrect ? " has-correct" : " none-correct") + (isNew ? " reveal" : "");

      function makeChip(text, mark, cls, delayIdx) {
        var chip = document.createElement("div");
        chip.className = "chip " + cls + (isNew ? " pop" : "");
        if (isNew) chip.style.animationDelay = delayIdx * 0.08 + "s";
        var span = document.createElement("span");
        span.textContent = text;
        var markSpan = document.createElement("span");
        markSpan.className = "mark";
        markSpan.textContent = mark;
        chip.appendChild(span);
        chip.appendChild(markSpan);
        return chip;
      }

      var brandChip = makeChip(g.brand, g.brandCorrect ? "✓" : "✕", g.brandCorrect ? "correct" : "wrong", 0);
      var modelChip = makeChip(g.model, g.modelCorrect ? "✓" : "✕", g.modelCorrect ? "correct" : "wrong", 1);
      var h = yearHint(g.year, car.year);
      var yearChip = makeChip(g.year, h.mark, h.cls, 2);

      slip.appendChild(brandChip);
      slip.appendChild(modelChip);
      slip.appendChild(yearChip);
      els.history.appendChild(slip);
    });
  }

  function updateCounter(state) {
    if (state.status === "playing") {
      els.guessCounter.textContent = "SIGHTING " + (state.guesses.length + 1) + " / " + MAX_GUESSES;
    } else {
      els.guessCounter.textContent = "CASE CLOSED";
    }
    renderDots(state);
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
    return "Next sighting in " + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
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
    var lines = ["CAR GUESSER — spotter log " + todayKey()];
    lines.push(won ? "Identified in " + state.guesses.length + "/" + MAX_GUESSES : "Unidentified — X/" + MAX_GUESSES);
    var rows = state.guesses.map(function (g) {
      var b = g.brandCorrect ? "🟩" : "⬜";
      var m = g.modelCorrect ? "🟩" : "⬜";
      var h = yearHint(g.year, car.year);
      var y = h.cls === "correct" ? "🟩" : h.cls === "close" ? "🟨" : "⬜";
      return b + m + y;
    });
    return lines.concat(rows).join("\n");
  }

  function finishGame(state, car, won, animate) {
    state.status = won ? "won" : "lost";
    saveState(state);
    updateCounter(state);
    els.form.classList.add("hidden");
    els.resultPanel.classList.remove("hidden");
    els.photo.style.transform = "scale(1)";
    els.exifFocal.textContent = FOCAL_LENGTHS[FOCAL_LENGTHS.length - 1] + "mm";
    els.exifStatus.textContent = won ? "STATUS: IDENTIFIED" : "STATUS: UNIDENTIFIED";
    els.exifStatus.classList.toggle("is-locked", won);
    els.photoFrame.classList.toggle("locked", won);

    els.resultStamp.textContent = won ? "Identified" : "Unidentified";
    els.resultStamp.className = "stamp " + (won ? "won" : "lost");
    els.resultDetail.textContent = car.brand + " " + car.model + " — MY" + car.year;
    els.resultPhoto.src = car.imageUrl;
    startCountdown();

    if (animate && !prefersReducedMotion()) {
      requestAnimationFrame(function () {
        els.resultStamp.classList.add("stamp-in");
      });
    } else {
      els.resultStamp.style.opacity = "1";
      els.resultStamp.style.transform = "rotate(-4deg) scale(1)";
    }

    els.shareBtn.onclick = function () {
      var text = buildShareText(state, car, won);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () {
          els.shareBtn.textContent = "Copied ✓";
          setTimeout(function () { els.shareBtn.textContent = "Copy Field Report"; }, 1800);
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
      els.photoLoading.textContent = "No sighting data. Check the cars/ folder and manifest.json.";
      return;
    }

    els.caseNoValue.textContent = "No. " + dayOfYear();

    var brands = Array.from(new Set(CARS.map(function (c) { return c.brand; }))).sort();
    var brandCombo = createCombo(
      els.brandInput,
      els.brandList,
      function (q) { return filterOptions(brands, q); },
      function (selected, typingOnly) {
        var isValid = selected !== null && brands.indexOf(selected) !== -1;
        if (!typingOnly) setLockState(els.brandInput, isValid);
        else setLockState(els.brandInput, brands.some(function (b) { return normalize(b) === normalize(els.brandInput.value); }));
        modelCombo.refresh();
      }
    );

    function modelsForBrand(brandText) {
      var normBrand = normalize(brandText);
      var matching = normBrand
        ? CARS.filter(function (c) { return normalize(c.brand).indexOf(normBrand) === 0; })
        : CARS;
      if (!matching.length) matching = CARS;
      return Array.from(new Set(matching.map(function (c) { return c.model; }))).sort();
    }

    var modelCombo = createCombo(
      els.modelInput,
      els.modelList,
      function (q) { return filterOptions(modelsForBrand(els.brandInput.value), q); },
      function (selected, typingOnly) {
        var pool = modelsForBrand(els.brandInput.value);
        if (!typingOnly) {
          setLockState(els.modelInput, selected !== null && pool.indexOf(selected) !== -1);
        } else {
          setLockState(els.modelInput, pool.some(function (m) { return normalize(m) === normalize(els.modelInput.value); }));
        }
      }
    );

    els.photo.src = car.imageUrl;
    els.photo.onload = function () {
      els.photoLoading.classList.add("hidden");
    };
    els.photo.onerror = function () {
      els.photoLoading.textContent = "Signal lost.";
    };

    var state = loadState(car);
    state._animateLast = false;
    applyZoom(state.guesses.length);
    renderHistory(state, car);
    updateCounter(state);

    if (state.status !== "playing") {
      finishGame(state, car, state.status === "won", false);
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
      state._animateLast = true;

      var won = brandCorrect && modelCorrect && yearCorrect;
      saveState(state);
      fireShutter();
      renderHistory(state, car);
      applyZoom(state.guesses.length);
      updateCounter(state);

      els.brandInput.value = "";
      els.modelInput.value = "";
      els.yearInput.value = "";
      setLockState(els.brandInput, false);
      setLockState(els.modelInput, false);
      brandCombo.close();
      modelCombo.close();
      brandCombo.suppressNextFocusOpen();
      els.brandInput.focus();

      if (won || state.guesses.length >= MAX_GUESSES) {
        setTimeout(function () {
          finishGame(state, car, won, true);
        }, prefersReducedMotion() ? 0 : 350);
      }

      state._animateLast = false;
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
        els.photoLoading.textContent = "Failed to load sighting data.";
        console.error(err);
      });
  });
})();
