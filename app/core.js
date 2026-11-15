(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TableDoctor = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DELIMITERS = [",", ";", "\t", "|"];
  var EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

  function normalizeText(text) {
    var fixes = [];
    var t = String(text == null ? "" : text);
    if (t.charCodeAt(0) === 0xfeff) {
      t = t.slice(1);
      fixes.push("stripped UTF-8 BOM");
    }
    if (/[\u00a0\u2007\u202f]/.test(t)) {
      t = t.replace(/[\u00a0\u2007\u202f]/g, " ");
      fixes.push("non-breaking spaces replaced");
    }
    if (/[\u200b-\u200d\ufeff]/.test(t)) {
      t = t.replace(/[\u200b-\u200d\ufeff]/g, "");
      fixes.push("zero-width characters removed");
    }
    if (/\r\n?/.test(t)) {
      t = t.replace(/\r\n?/g, "\n");
      fixes.push("line endings normalized");
    }
    return { text: t, fixes: fixes };
  }

  function median(nums) {
    if (!nums.length) return 0;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function sniffDelimiter(text, maxLines) {
    var lines = String(text).split("\n").slice(0, maxLines || 25);
    var best = ",";
    var bestScore = -1;
    DELIMITERS.forEach(function (d) {
      var counts = [];
      var cur = 0;
      var inQuotes = false;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        cur = 0;
        inQuotes = false;
        for (var j = 0; j < line.length; j++) {
          var ch = line[j];
          if (ch === '"') {
            if (inQuotes && line[j + 1] === '"') { j++; continue; }
            inQuotes = !inQuotes;
          } else if (!inQuotes && ch === d) {
            cur++;
          }
        }
        counts.push(cur);
      }
      var nonZero = counts.filter(function (c) { return c > 0; });
      if (!nonZero.length) return;
      var score = median(nonZero);
      if (score > bestScore || (score === bestScore && d === ",")) {
        bestScore = score;
        best = d;
      }
    });
    return bestScore > 0 ? best : ",";
  }

  function parseDelimited(text, delimiter) {
    var src = String(text);
    var delim = delimiter || sniffDelimiter(src);
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var warnings = [];
    var i = 0;
    var ragged = 0;
    while (i < src.length) {
      var ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"' && field.trim() === "") { inQuotes = true; field = ""; i++; continue; }
      if (ch === delim) { row.push(field); field = ""; i++; continue; }
      if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      if (ch === "\0") { i++; continue; }
      field += ch; i++;
    }
    if (inQuotes) warnings.push("unbalanced quote at end of input: auto-closed");
    if (field.length || row.length) { row.push(field); rows.push(row); }
    while (rows.length && rows[rows.length - 1].every(function (v) { return String(v).trim() === ""; })) rows.pop();

    var width = rows.length ? Math.max.apply(null, rows.map(function (r) { return r.length; })) : 0;
    rows = rows.map(function (r) {
      if (r.length !== width) ragged++;
      while (r.length < width) r.push("");
      return r;
    });
    if (ragged) warnings.push(ragged + " row(s) had a different field count and were padded");
    return { rows: rows, delimiter: delim, warnings: warnings };
  }

  function normalizeHeaders(rawHeaders) {
    var fixes = [];
    var seen = Object.create(null);
    var out = rawHeaders.map(function (h, idx) {
      var v = String(h == null ? "" : h).trim().replace(/^"|"$/g, "").replace(/\s+/g, " ");
      if (!v) {
        v = "column_" + (idx + 1);
        fixes.push("empty header at position " + (idx + 1) + " -> " + v);
      }
      var key = v.toLowerCase();
      if (seen[key]) {
        seen[key] += 1;
        var next = v + "_" + seen[key];
        fixes.push("duplicate header \"" + v + "\" -> " + next);
        v = next;
        key = v.toLowerCase();
        seen[key] = 1;
      } else {
        seen[key] = 1;
      }
      return v;
    });
    return { headers: out, fixes: fixes };
  }

  function isEmail(value) {
    var v = String(value == null ? "" : value).trim();
    if (!v || v.length > 254) return false;
    if (v.indexOf("..") !== -1) return false;
    return EMAIL_RE.test(v);
  }

  function canonEmail(value) {
    var v = String(value == null ? "" : value).trim().toLowerCase();
    var at = v.lastIndexOf("@");
    if (at < 1) return v;
    var local = v.slice(0, at);
    var domain = v.slice(at + 1);
    if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
    return local + "@" + domain;
  }

  function digits(value) {
    return String(value == null ? "" : value).replace(/\D/g, "");
  }

  function isPhone(value) {
    var d = digits(value);
    return d.length >= 10 && d.length <= 15;
  }

  function canonPhone(value) {
    var d = digits(value);
    return d.length > 10 ? d.slice(-10) : d;
  }

  function parseNumber(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return { ok: false, reason: "empty" };
    var s = raw.replace(/[\s\u00a0]/g, "");
    var hasComma = s.indexOf(",") !== -1;
    var hasDot = s.indexOf(".") !== -1;
    var ambiguous = false;
    if (hasComma && hasDot) {
      s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else if (hasComma) {
      var parts = s.split(",");
      if (parts.length === 2 && parts[1].length !== 3) s = parts[0] + "." + parts[1];
      else { ambiguous = parts[1] && parts[1].length === 3; s = s.replace(/,/g, ""); }
    }
    if (!/^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?$/.test(s)) return { ok: false, reason: "not numeric", raw: raw };
    var n = Number(s);
    if (!isFinite(n)) return { ok: false, reason: "not finite", raw: raw };
    return { ok: true, value: n, ambiguous: ambiguous, raw: raw };
  }

  function parseDate(value, dayFirst) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return { ok: false, reason: "empty" };
    var m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(raw))) {
      return buildDate(+m[1], +m[2], +m[3], raw);
    }
    if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(raw))) {
      var a = +m[1];
      var b = +m[2];
      var y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      var ambiguous = a <= 12 && b <= 12 && a !== b;
      var day = dayFirst === false ? b : a;
      var month = dayFirst === false ? a : b;
      if (day > 31 || month > 12) { day = b; month = a; }
      return buildDate(y, month, day, raw, ambiguous);
    }
    return { ok: false, reason: "unrecognized format", raw: raw };
  }

  function buildDate(y, m, d, raw, ambiguous) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return { ok: false, reason: "out of range", raw: raw };
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      return { ok: false, reason: "invalid calendar date", raw: raw };
    }
    return { ok: true, value: dt, iso: dt.toISOString().slice(0, 10), ambiguous: !!ambiguous, raw: raw };
  }

  function isUrl(value) {
    var v = String(value == null ? "" : value).trim();
    if (!/^https?:\/\//i.test(v)) return false;
    try { new URL(v); return true; } catch (e) { return false; }
  }

  function levenshtein(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > (max || Infinity)) return (max || Infinity) + 1;
    var prev = new Array(b.length + 1);
    var cur = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur[0] = i;
      var best = cur[0];
      for (var k = 1; k <= b.length; k++) {
        var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
        if (cur[k] < best) best = cur[k];
      }
      if (max != null && best > max) return max + 1;
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[b.length];
  }

  function squash(value) {
    return String(value == null ? "" : value).toLowerCase().replace(/[\s\u00a0"'`.,()\-_/\\]/g, "");
  }

  function profileColumn(values) {
    var nonEmpty = [];
    var empties = 0;
    values.forEach(function (v) {
      var s = String(v == null ? "" : v).trim();
      if (!s) empties++;
      else if (nonEmpty.length < 500) nonEmpty.push(s);
    });
    var counts = { email: 0, phone: 0, number: 0, date: 0, url: 0 };
    nonEmpty.forEach(function (v) {
      if (isEmail(v)) counts.email++;
      if (isPhone(v)) counts.phone++;
      if (parseNumber(v).ok) counts.number++;
      if (parseDate(v).ok) counts.date++;
      if (isUrl(v)) counts.url++;
    });
    var type = "text";
    var bestCount = 0;
    ["email", "url", "phone", "date", "number"].forEach(function (k) {
      if (counts[k] > bestCount) { bestCount = counts[k]; type = k; }
    });
    var threshold = nonEmpty.length <= 3 ? 0.5 : 0.8;
    return {
      type: nonEmpty.length && bestCount / nonEmpty.length >= threshold ? type : "text",
      empty: empties,
      filled: nonEmpty.length,
      distinct: new Set(nonEmpty.map(function (v) { return v.toLowerCase(); })).size,
      invalid: type === "text" ? [] : nonEmpty.filter(function (v) { return !matchesType(v, type); })
    };
  }

  function matchesType(v, type) {
    if (type === "email") return isEmail(v);
    if (type === "phone") return isPhone(v);
    if (type === "url") return isUrl(v);
    if (type === "number") return parseNumber(v).ok;
    if (type === "date") return parseDate(v).ok;
    return true;
  }

  function keyFor(values, idxs, mode) {
    var parts = idxs.map(function (i) { return String(values[i] == null ? "" : values[i]); });
    if (mode === "exact") return parts.join("\u0001").trim().toLowerCase();
    return parts.map(function (p) {
      if (isEmail(p)) return "e:" + canonEmail(p);
      if (isPhone(p) && digits(p).length >= 10) return "p:" + canonPhone(p);
      return "t:" + squash(p);
    }).join("|");
  }

  function dedupe(rows, headers, options) {
    var opts = options || {};
    var keyColumns = opts.keyColumns && opts.keyColumns.length ? opts.keyColumns : headers;
    var idxs = keyColumns.map(function (c) { return headers.indexOf(c); }).filter(function (i) { return i >= 0; });
    var mode = opts.mode === "exact" ? "exact" : "normalized";
    var fuzzy = !!opts.fuzzy;
    var maxDistance = opts.maxDistance == null ? 2 : opts.maxDistance;
    var keep = opts.keep === "last" ? "last" : "first";
    var kept = [];
    var removed = [];
    var byKey = Object.create(null);
    var buckets = Object.create(null);

    rows.forEach(function (row, index) {
      var rawValues = idxs.map(function (i) { return String(row[i] == null ? "" : row[i]); });
      if (rawValues.every(function (v) { return v.trim() === ""; })) {
        kept.push({ row: row, index: index });
        return;
      }
      var key = keyFor(row, idxs, mode);
      var match = byKey[key];
      if (match == null && fuzzy) {
        var bucketKey = squash(idxs.map(function (i) { return row[i]; }).join("")).slice(0, 6);
        var candidates = buckets[bucketKey] || [];
        for (var c = 0; c < candidates.length; c++) {
          var cand = candidates[c];
          var candKey = keyFor(cand.row, idxs, mode);
          if (levenshtein(key, candKey, maxDistance) <= maxDistance) { match = cand; break; }
        }
      }
      if (match != null) {
        removed.push({ row: row, index: index, duplicateOf: match.index, key: key });
        if (keep === "last") {
          var pos = kept.indexOf(match);
          if (pos >= 0) kept.splice(pos, 1);
          var replaced = { row: row, index: index };
          kept.push(replaced);
          byKey[keyFor(row, idxs, mode)] = replaced;
          var bk = squash(idxs.map(function (i) { return row[i]; }).join("")).slice(0, 6);
          (buckets[bk] = buckets[bk] || []).push(replaced);
        }
        return;
      }
      var entry = { row: row, index: index };
      byKey[key] = entry;
      var bkey = squash(idxs.map(function (i) { return row[i]; }).join("")).slice(0, 6);
      (buckets[bkey] = buckets[bkey] || []).push(entry);
      kept.push(entry);
    });

    return {
      kept: kept.sort(function (a, b) { return a.index - b.index; }).map(function (e) { return e.row; }),
      removed: removed,
      keptCount: kept.length,
      removedCount: removed.length
    };
  }

  function needsFormulaEscape(value) {
    var v = String(value == null ? "" : value);
    if (/^=/.test(v)) return true;
    if (/^[+\-@]/.test(v)) return !parseNumber(v).ok && !isPhone(v);
    return /^[\t\r]/.test(v);
  }

  function escapeFormula(value) {
    var v = String(value == null ? "" : value);
    return needsFormulaEscape(v) ? "'" + v : v;
  }

  function csvCell(value, delimiter) {
    var v = String(value == null ? "" : value);
    if (v.indexOf('"') !== -1 || v.indexOf(delimiter) !== -1 || /[\n\r]/.test(v)) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  }

  function toCSV(rows, delimiter, options) {
    var opts = options || {};
    var d = delimiter || ",";
    var body = rows.map(function (r) {
      return r.map(function (c) { return csvCell(opts.escapeFormulas ? escapeFormula(c) : c, d); }).join(d);
    }).join("\n");
    return (opts.bom ? "\ufeff" : "") + body + (opts.trailingNewline === false ? "" : "\n");
  }

  function analyze(rows, headers, options) {
    var opts = options || {};
    var body = rows;
    var warnings = [];
    var columns = headers.map(function (h, i) {
      var values = body.map(function (r) { return r[i]; });
      var profile = profileColumn(values);
      profile.name = h;
      profile.index = i;
      return profile;
    });
    var emptyRows = body.filter(function (r) { return r.every(function (c) { return String(c).trim() === ""; }); }).length;
    var formulaCells = 0;
    var longCells = 0;
    body.forEach(function (r) {
      r.forEach(function (c) {
        var s = String(c == null ? "" : c);
        if (needsFormulaEscape(s)) formulaCells++;
        if (s.length > 32767) longCells++;
      });
    });
    if (formulaCells) warnings.push(formulaCells + " cell(s) start with = + - @ (spreadsheet formula-injection risk)");
    if (longCells) warnings.push(longCells + " cell(s) exceed Excel's 32,767 character limit");
    var dupes = dedupe(body, headers, opts.dedupe || {});
    return {
      rowCount: body.length,
      columnCount: headers.length,
      emptyRows: emptyRows,
      columns: columns,
      warnings: warnings,
      formulaCells: formulaCells,
      duplicates: dupes.removedCount
    };
  }

  function applyCleanup(rows, headers, options) {
    var opts = options || {};
    var log = [];
    var out = rows.map(function (r) {
      return r.map(function (c, i) {
        var v = String(c == null ? "" : c);
        var original = v;
        v = v.replace(/[\u00a0\u2007\u202f]/g, " ").replace(/[\u200b-\u200d\ufeff]/g, "");
        v = v.trim().replace(/[ \t]{2,}/g, " ");
        var unwrapped = /^="(.*)"$/.exec(v);
        if (unwrapped) v = unwrapped[1];
        if (opts.fixFormulaInjection && needsFormulaEscape(v)) v = "'" + v;
        if (v !== original) log.push({ row: 0, column: headers[i], from: original, to: v });
        return v;
      });
    });
    return { rows: out, log: log };
  }

  function buildReport(stats, meta) {
    var lines = [];
    lines.push("# TableDoctor report");
    lines.push("Generated: " + (meta && meta.generatedAt ? meta.generatedAt : new Date().toISOString()));
    if (meta && meta.source) lines.push("Source file: " + meta.source);
    lines.push("");
    lines.push("Rows: " + stats.rowCount + " | Columns: " + stats.columnCount + " | Empty rows: " + stats.emptyRows);
    lines.push("Duplicates removed: " + stats.duplicates);
    lines.push("");
    lines.push("| Column | Type | Filled | Empty | Distinct | Invalid |");
    lines.push("|---|---|---|---|---|---|");
    stats.columns.forEach(function (c) {
      lines.push("| " + c.name + " | " + c.type + " | " + c.filled + " | " + c.empty + " | " + c.distinct + " | " + c.invalid.length + " |");
    });
    if (stats.warnings.length) {
      lines.push("");
      lines.push("## Warnings");
      stats.warnings.forEach(function (w) { lines.push("- " + w); });
    }
    return lines.join("\n") + "\n";
  }

  return {
    normalizeText: normalizeText,
    sniffDelimiter: sniffDelimiter,
    parseDelimited: parseDelimited,
    normalizeHeaders: normalizeHeaders,
    dedupe: dedupe,
    analyze: analyze,
    applyCleanup: applyCleanup,
    buildReport: buildReport,
    toCSV: toCSV,
    profileColumn: profileColumn,
    parseNumber: parseNumber,
    parseDate: parseDate,
    isEmail: isEmail,
    isPhone: isPhone,
    isUrl: isUrl,
    canonEmail: canonEmail,
    canonPhone: canonPhone,
    escapeFormula: escapeFormula,
    needsFormulaEscape: needsFormulaEscape,
    levenshtein: levenshtein
  };
});
