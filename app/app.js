(function () {
  "use strict";

  var C = window.TableDoctor;
  var LIMITS = window.TD_LIMITS || { maxRows: Infinity, xlsx: true, label: "Pro" };
  var state = { headers: [], rows: [], clean: [], stats: null, fileName: "", delimiter: ",", encoding: "", source: "" };

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function decodeBuffer(buffer) {
    var bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8 (BOM)" };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "UTF-16LE" };
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "UTF-16BE" };
    }
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
    } catch (e) {
      try {
        return { text: new TextDecoder("windows-1251").decode(bytes), encoding: "Windows-1251" };
      } catch (e2) {
        return { text: new TextDecoder("latin1").decode(bytes), encoding: "Latin-1" };
      }
    }
  }

  function readWorkbook(buffer) {
    var wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
    var ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, blankrows: false }).map(function (r) {
      return r.map(function (c) { return String(c == null ? "" : c); });
    });
  }

  function guessKeys(headers, rows) {
    var probe = C.analyze(rows, headers, {});
    var email = probe.columns.filter(function (c) { return c.type === "email"; })[0];
    var phone = probe.columns.filter(function (c) { return c.type === "phone"; })[0];
    if (email) return [email.name];
    if (phone) return [phone.name];
    return headers.slice(0, Math.min(2, headers.length));
  }

  function renderKeyOptions(selected) {
    var sel = $("keyColumns");
    sel.innerHTML = state.headers.map(function (h) {
      return '<option value="' + esc(h) + '"' + (selected.indexOf(h) !== -1 ? " selected" : "") + ">" + esc(h) + "</option>";
    }).join("");
  }

  function runPipeline() {
    var delimiter = $("delimiter").value;
    var raw = state.source;
    var norm = C.normalizeText(raw);
    var parsed = C.parseDelimited(norm.text, delimiter === "auto" ? undefined : delimiter);
    if (!parsed.rows.length) { alert("No rows found in this file."); return; }

    var headerRow = parsed.rows[0].map(function (h) { return String(h).replace(/^"|"$/g, "").trim(); });
    var headers = C.normalizeHeaders(headerRow).headers;
    var body = parsed.rows.slice(1);
    if (body.length > LIMITS.maxRows) {
      alert("This build handles up to " + LIMITS.maxRows + " rows. Your file has " + body.length +
        ". The Pro build removes the limit and adds XLSX export.\n\nOpen tabledoctor.pro to unlock.");
      body = body.slice(0, LIMITS.maxRows);
    }
    var emptyDropped = body.filter(function (r) { return r.every(function (c) { return String(c).trim() === ""; }); }).length;
    body = body.filter(function (r) { return !r.every(function (c) { return String(c).trim() === ""; }); });
    state.emptyDropped = emptyDropped;
    state.rows = body;
    state.headers = headers;
    state.delimiter = parsed.delimiter;

    if (!state.keysChosen) {
      renderKeyOptions(guessKeys(headers, body));
      state.keysChosen = true;
    } else {
      var current = Array.prototype.map.call($("keyColumns").selectedOptions, function (o) { return o.value; });
      renderKeyOptions(current.filter(function (v) { return headers.indexOf(v) !== -1; }));
    }

    var cleaned = C.applyCleanup(body, headers, { fixFormulaInjection: $("formula").checked });
    var keyColumns = Array.prototype.map.call($("keyColumns").selectedOptions, function (o) { return o.value; });
    var mode = $("dedupeMode").value;
    var dedupeOpts = mode === "off"
      ? { keyColumns: [] }
      : { keyColumns: keyColumns, mode: mode, fuzzy: $("fuzzy").checked, keep: $("keep").value };

    var dedupeResult = mode === "off"
      ? { kept: cleaned.rows, removed: [], removedCount: 0 }
      : C.dedupe(cleaned.rows, headers, dedupeOpts);

    state.clean = dedupeResult.kept;
    state.stats = C.analyze(dedupeResult.kept, headers, {});
    state.stats.duplicates = dedupeResult.removedCount;
    var neutralized = cleaned.log.filter(function (l) { return l.to === "'" + l.from; }).length;
    state.stats.warnings = state.stats.warnings.concat(parsed.warnings, norm.fixes.map(function (f) { return "auto-fix: " + f; }));
    if (emptyDropped) state.stats.warnings.push(emptyDropped + " fully empty row(s) dropped");
    if (neutralized) state.stats.warnings.push(neutralized + " formula-like cell(s) neutralized with a leading apostrophe");
    state.removed = dedupeResult.removed;

    render();
    $("results").hidden = false;
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function render() {
    var s = state.stats;
    var invalidTotal = s.columns.reduce(function (a, c) { return a + c.invalid.length; }, 0);
    var cards = [
      { label: "rows", value: s.rowCount, cls: "" },
      { label: "columns", value: s.columnCount, cls: "" },
      { label: "duplicates removed", value: s.duplicates, cls: s.duplicates ? "bad" : "good" },
      { label: "invalid values", value: invalidTotal, cls: invalidTotal ? "bad" : "good" },
      { label: "empty rows", value: s.emptyRows, cls: s.emptyRows ? "bad" : "good" }
    ];
    $("cards").innerHTML = cards.map(function (c) {
      return '<div class="card ' + c.cls + '"><b>' + c.value + "</b><span>" + c.label + "</span></div>";
    }).join("");

    $("warnings").innerHTML = s.warnings.map(function (w) { return "<div>" + esc(w) + "</div>"; }).join("");

    $("colTable").innerHTML =
      "<thead><tr><th>Column</th><th>Type</th><th>Filled</th><th>Empty</th><th>Distinct</th><th>Invalid</th></tr></thead><tbody>" +
      s.columns.map(function (c) {
        return "<tr><td><strong>" + esc(c.name) + "</strong></td><td>" + c.type + '</td><td class="num">' + c.filled +
          '</td><td class="num">' + c.empty + '</td><td class="num">' + c.distinct +
          '</td><td class="num' + (c.invalid.length ? " bad" : "") + '">' + c.invalid.length + "</td></tr>";
      }).join("") + "</tbody>";

    var limit = Math.min(state.clean.length, 120);
    var head = "<thead><tr><th>#</th>" + state.headers.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead>";
    var rows = state.clean.slice(0, limit).map(function (r, i) {
      return "<tr><td class='num'>" + (i + 1) + "</td>" + r.map(function (v, ci) {
        var col = s.columns[ci];
        var invalid = col && col.invalid.indexOf(String(v).trim()) !== -1;
        var cls = invalid ? "bad" : (String(v).trim() === "" ? "empty" : (col && col.type === "number" ? "num" : ""));
        return "<td class='" + cls + "' title='" + esc(v) + "'>" + (String(v).trim() === "" ? "—" : esc(v)) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    $("preview").innerHTML = head + "<tbody>" + rows + "</tbody>";
    $("previewNote").textContent = "showing " + limit + " of " + state.clean.length + " cleaned rows · delimiter «" + (state.delimiter === "\t" ? "tab" : state.delimiter) + "» · encoding " + state.encoding;
    $("xlsx").disabled = typeof XLSX === "undefined" || !LIMITS.xlsx;
    if (!LIMITS.xlsx) $("xlsx").title = "XLSX export is available in the Pro build";
  }

  function baseName() {
    return (state.fileName || "table").replace(/\.(csv|tsv|txt|xlsx|xls)$/i, "");
  }

  function download(name, mime, content) {
    var blob = new Blob([content], { type: mime });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function loadBuffer(buffer, name) {
    state.fileName = name;
    state.keysChosen = false;
    var lower = name.toLowerCase();
    if (/\.xlsx?$/.test(lower)) {
      try {
        var aoa = readWorkbook(buffer);
        if (!aoa.length) { alert("The first sheet is empty."); return; }
        var dec = { text: aoa.map(function (r) { return r.join("\t"); }).join("\n"), encoding: "XLSX (first sheet)" };
        state.source = dec.text;
        state.encoding = dec.encoding;
        state.delimiter = "\t";
      } catch (e) {
        alert("Could not read this workbook: " + e.message);
        return;
      }
    } else {
      var decoded = decodeBuffer(buffer);
      state.source = decoded.text;
      state.encoding = decoded.encoding;
      state.delimiter = "auto";
    }
    $("options").hidden = false;
    $("delimiter").value = state.delimiter === "\t" ? "\t" : "auto";
    runPipeline();
  }

  function loadText(text, name) {
    state.fileName = name;
    state.keysChosen = false;
    state.source = text;
    state.encoding = "pasted text";
    state.delimiter = "auto";
    $("options").hidden = false;
    $("delimiter").value = "auto";
    runPipeline();
  }

  var SAMPLE = 'Name,Email,Company,Phone,Amount,Zip,Note\n' +
    '"Smith, John",John.Smith@Gmail.com,Acme Logistics,+1 (202) 555-0100,"1 250,50",007,"call ""ASAP"""\n' +
    'John Smith,johnsmith@gmail.com,Acme Logistic,202.555.0100,1250.5,007,duplicate of row 1\n' +
    ',bad-email@,Zenith Freight,,,,\n' +
    'Иван Петров,ivan@example.ru,ООО «Ромашка»,8 999 123-45-67,"12 000,00",101000,"=HYPERLINK(""http://x"")"\n' +
    'Marta Diaz,marta@diaz.co,Zenith Freight ,+1 202 555 0199,89.9,33101,  extra   spaces  \n' +
    'Marta Diaz,marta@diaz.co,Zenith Freight,+12025550199,89.9,33101,xlsx artifact\n' +
    'Peter Novak,peter@novak.cz,Novak s.r.o.,+420 601 123 456,"2 400,00",11000,\n' +
    ',,,,,,\n' +
    'Ariel Kim,ariel.kim@mail.com,Kim Studio,202-555-0177,17.25,94103,"' + String.fromCharCode(160) + 'nbsp inside"\n';

  function wire() {
    var drop = $("drop");
    var file = $("file");

    $("pick").addEventListener("click", function () { file.click(); });
    file.addEventListener("change", function () {
      var f = file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { loadBuffer(reader.result, f.name); };
      reader.readAsArrayBuffer(f);
    });

    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
    });
    drop.addEventListener("drop", function (e) {
      var f = e.dataTransfer.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { loadBuffer(reader.result, f.name); };
      reader.readAsArrayBuffer(f);
    });

    $("sample").addEventListener("click", function () { loadText(SAMPLE, "sample-leads.csv"); });
    $("run").addEventListener("click", runPipeline);

    $("csv").addEventListener("click", function () {
      var all = [state.headers].concat(state.clean);
      download(baseName() + "-clean.csv", "text/csv;charset=utf-8", C.toCSV(all, ",", { bom: true }));
    });

    $("xlsx").addEventListener("click", function () {
      var all = [state.headers].concat(state.clean);
      var ws = XLSX.utils.aoa_to_sheet(all);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "clean");
      XLSX.writeFile(wb, baseName() + "-clean.xlsx");
    });

    $("report").addEventListener("click", function () {
      var md = C.buildReport(state.stats, { source: state.fileName, generatedAt: new Date().toISOString() });
      if (state.removed && state.removed.length) {
        md += "\n## Removed duplicates\n";
        state.removed.slice(0, 50).forEach(function (d) {
          md += "- source row " + (d.index + 2) + " duplicates row " + (d.duplicateOf + 2) + "\n";
        });
      }
      download(baseName() + "-report.md", "text/markdown;charset=utf-8", md);
    });

    $("again").addEventListener("click", function () {
      state = { headers: [], rows: [], clean: [], stats: null, fileName: "", delimiter: ",", encoding: "", source: "" };
      file.value = "";
      $("results").hidden = true;
      $("options").hidden = true;
      $("keyColumns").innerHTML = "";
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  document.addEventListener("DOMContentLoaded", wire);
})();
