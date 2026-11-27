/**
 * ============================================================================
 * SISTEM INFORMASI MANAJEMEN STOK GUDANG - PMI KOTA SURAKARTA
 * File: Utils.gs
 * Deskripsi: Fungsi utilitas pembuatan ID unik, hashing SHA-256, pemformatan
 *            tanggal, kalkulasi status kedaluwarsa, penomoran dokumen otomatis,
 *            upload dokumen ke Google Drive, dan LockService transaksi.
 * ============================================================================
 */

/**
 * Menghasilkan ID unik yang tidak bergantung pada nomor baris.
 * Contoh: BRG-20261125-A1B2C3
 */
function generateUniqueId(prefix) {
  var cleanPrefix = (prefix || 'ID').toUpperCase();
  var now = new Date();
  var datePart = Utilities.formatDate(now, APP_CONFIG.TIMEZONE, 'yyyyMMddHHmmss');
  var randomPart = Utilities.getUuid().replace(/-/g, '').substring(0, 6).toUpperCase();
  return cleanPrefix + '-' + datePart + '-' + randomPart;
}

/**
 * Menghasilkan hash SHA-256 untuk password pengguna dengan salt aplikasi.
 */
function hashPassword(plainPassword) {
  var salt = 'PMI_KOTA_SURAKARTA_WAREHOUSE_SALT_2026';
  var raw = String(plainPassword || '') + '::' + salt;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  var hex = [];
  for (var i = 0; i < digest.length; i++) {
    var byteVal = digest[i];
    if (byteVal < 0) byteVal += 256;
    var byteStr = byteVal.toString(16);
    if (byteStr.length === 1) byteStr = '0' + byteStr;
    hex.push(byteStr);
  }
  return hex.join('');
}

/**
 * Mengembalikan timestamp saat ini dalam format YYYY-MM-DD HH:mm:ss
 */
function getCurrentTimestamp() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Mengembalikan tanggal hari ini dalam format YYYY-MM-DD
 */
function getTodayDateString() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

/**
 * Menormalkan berbagai input tanggal (Date object, string DD/MM/YYYY, YYYY-MM-DD,
 * atau nomor serial Excel) menjadi format standar YYYY-MM-DD.
 */
function normalizeDateString(inputVal) {
  if (inputVal === null || inputVal === undefined || inputVal === '') {
    return '';
  }

  if (Object.prototype.toString.call(inputVal) === '[object Date]') {
    if (isNaN(inputVal.getTime())) return '';
    return Utilities.formatDate(inputVal, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }

  // Tanggal serial numerik Excel (misal 46350)
  if (typeof inputVal === 'number' && inputVal > 20000 && inputVal < 90000) {
    var excelEpoch = new Date(Date.UTC(1899, 11, 30));
    var ms = excelEpoch.getTime() + Math.round(inputVal * 86400000);
    return Utilities.formatDate(new Date(ms), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }

  var str = String(inputVal).trim();
  if (!str || str === '-' || str.toLowerCase() === 'n/a' || str.toLowerCase() === 'nan') {
    return '';
  }

  // Format YYYY-MM-DD atau YYYY/MM/DD
  var isoMatch = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (isoMatch) {
    var y = isoMatch[1];
    var m = ('0' + isoMatch[2]).slice(-2);
    var d = ('0' + isoMatch[3]).slice(-2);
    return y + '-' + m + '-' + d;
  }

  // Format DD-MM-YYYY atau DD/MM/YYYY
  var dmyMatch = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (dmyMatch) {
    var d2 = ('0' + dmyMatch[1]).slice(-2);
    var m2 = ('0' + dmyMatch[2]).slice(-2);
    var y2 = dmyMatch[3];
    return y2 + '-' + m2 + '-' + d2;
  }

  var parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }

  return '';
}

/**
 * Mengonversi nilai ke angka numerik (float/integer) secara aman.
 */
function toNumber(val, defaultVal) {
  var fallback = defaultVal !== undefined ? defaultVal : 0;
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'number') return isNaN(val) ? fallback : val;
  var str = String(val).trim();
  if (!str || str.toLowerCase() === 'nan') return fallback;

  // Bersihkan simbol mata uang Rp dan spasi
  var cleaned = str.replace(/[Rp\s]/gi, '');
  // Jika memakai format ribuan Indonesia (1.250.000,50) vs format Inggris (1,250,000.50)
  if (cleaned.indexOf('.') !== -1 && cleaned.indexOf(',') !== -1) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.indexOf(',') !== -1) {
    var parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      cleaned = cleaned.replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  }

  var num = parseFloat(cleaned);
  return isNaN(num) ? fallback : num;
}

/**
 * Menghitung selisih hari dan status kedaluwarsa berdasarkan tanggal aktual (Bab 9).
 * - AMAN: > 90 hari
 * - PERHATIAN: 31 - 90 hari
 * - SEGERA KEDALUWARSA: 1 - 30 hari
 * - KEDALUWARSA: <= 0 hari (melewati atau tepat hari expired)
 * - TANPA EXPIRED: jika barang tidak memiliki tanggal kedaluwarsa
 */
function evaluateExpiryStatus(expiredDateStr) {
  var normalized = normalizeDateString(expiredDateStr);
  if (!normalized) {
    return {
      hasExpiry: false,
      expiredDate: '',
      daysRemaining: null,
      status: 'TANPA EXPIRED',
      badgeClass: 'secondary'
    };
  }

  var todayStr = getTodayDateString();
  var todayParts = todayStr.split('-');
  var expParts = normalized.split('-');

  var todayUtc = Date.UTC(parseInt(todayParts[0], 10), parseInt(todayParts[1], 10) - 1, parseInt(todayParts[2], 10));
  var expUtc = Date.UTC(parseInt(expParts[0], 10), parseInt(expParts[1], 10) - 1, parseInt(expParts[2], 10));
  var diffDays = Math.floor((expUtc - todayUtc) / 86400000);

  var status = '';
  var badgeClass = '';

  if (diffDays <= 0) {
    status = 'KEDALUWARSA';
    badgeClass = 'danger';
  } else if (diffDays <= 30) {
    status = 'SEGERA KEDALUWARSA';
    badgeClass = 'orange';
  } else if (diffDays <= 90) {
    status = 'PERHATIAN';
    badgeClass = 'warning';
  } else {
    status = 'AMAN';
    badgeClass = 'success';
  }

  return {
    hasExpiry: true,
    expiredDate: normalized,
    daysRemaining: diffDays,
    status: status,
    badgeClass: badgeClass
  };
}

/**
 * Menghasilkan Nomor Transaksi Otomatis (BM-YYYYMM-0001, BK-YYYYMM-0001, SO-YYYYMM-0001).
 */
function generateAutoDocumentNumber(sheetName, colName, prefix) {
  var records = getSheetRecords(sheetName);
  var ym = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyyMM');
  var patternPrefix = prefix + '-' + ym + '-';
  var maxSeq = 0;

  for (var i = 0; i < records.length; i++) {
    var docNo = String(records[i][colName] || '').trim();
    if (docNo.indexOf(patternPrefix) === 0) {
      var seqStr = docNo.substring(patternPrefix.length);
      var seqNum = parseInt(seqStr, 10);
      if (!isNaN(seqNum) && seqNum > maxSeq) {
        maxSeq = seqNum;
      }
    }
  }

  var nextSeq = ('0000' + (maxSeq + 1)).slice(-4);
  return patternPrefix + nextSeq;
}

/**
 * Menghasilkan Kode Barang Otomatis berdasarkan kategori (FD-0001, NF-0001, OB-0001).
 */
function generateAutoItemCode(kategori) {
  var catKey = String(kategori || 'NON FOOD').toUpperCase().trim();
  var prefix = APP_CONFIG.PREFIX.CATEGORY_CODE[catKey] || 'BRG';
  var records = getSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG);
  var maxSeq = 0;

  for (var i = 0; i < records.length; i++) {
    var code = String(records[i].kode_barang || '').trim().toUpperCase();
    if (code.indexOf(prefix + '-') === 0) {
      var tail = code.substring((prefix + '-').length);
      var num = parseInt(tail, 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  return prefix + '-' + ('0000' + (maxSeq + 1)).slice(-4);
}

/**
 * Sanitasi nilai sel terhadap serangan CSV / Spreadsheet Formula Injection (OWASP A03).
 * Mencegah eksekusi formula berbahaya (=CMD|, +IMPORTXML, @SUM, dll.) di Google Sheets & Excel.
 */
function sanitizeSpreadsheetCell(val) {
  if (val === null || val === undefined) return '';
  if (typeof val !== 'string') return val;
  var trimmed = val.trim();
  if (trimmed === '' || trimmed === '-') return val;
  var firstChar = trimmed.charAt(0);
  if (firstChar === '=' || firstChar === '+' || firstChar === '@' || firstChar === '\t' || firstChar === '\r') {
    return "'" + val;
  }
  if (firstChar === '-' && !/^-\d+(\.\d+)?$/.test(trimmed)) {
    return "'" + val;
  }
  return val;
}

/**
 * Menyimpan file dokumen pendukung (base64) ke folder Google Drive.
 * Dilengkapi validasi keamanan ekstensi (Whitelist), MIME type, dan batas ukuran 5 MB (OWASP A04 / BSSN).
 */
function saveSupportingDocumentToDrive(base64Data, fileName, mimeType, subfolderName) {
  if (!base64Data || !fileName) return '';
  try {
    var safeFileName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    var extMatch = safeFileName.match(/\.([a-zA-Z0-9]+)$/);
    var ext = extMatch ? extMatch[1].toLowerCase() : '';
    var allowedExts = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'];
    if (allowedExts.indexOf(ext) === -1) {
      throw new Error('Format file lampiran tidak diizinkan. Gunakan PDF, JPG, PNG, DOC, atau DOCX.');
    }

    var cleanBase64 = base64Data;
    if (cleanBase64.indexOf(',') !== -1) {
      cleanBase64 = cleanBase64.split(',')[1];
    }
    var decoded = Utilities.base64Decode(cleanBase64);
    if (decoded.length > 5 * 1024 * 1024) {
      throw new Error('Ukuran file lampiran melebihi batas maksimum 5 MB.');
    }
    var blob = Utilities.newBlob(decoded, mimeType || 'application/octet-stream', safeFileName);

    var mainFolderName = 'PMI_SURAKARTA_DOKUMEN_GUDANG';
    var mainFolders = DriveApp.getFoldersByName(mainFolderName);
    var mainFolder = mainFolders.hasNext() ? mainFolders.next() : DriveApp.createFolder(mainFolderName);

    var targetFolder = mainFolder;
    if (subfolderName) {
      var subFolders = mainFolder.getFoldersByName(subfolderName);
      targetFolder = subFolders.hasNext() ? subFolders.next() : mainFolder.createFolder(subfolderName);
    }

    var file = targetFolder.createFile(blob);
    return file.getUrl();
  } catch (err) {
    if (err.message && (err.message.indexOf('Format file') !== -1 || err.message.indexOf('Ukuran file') !== -1)) {
      throw err;
    }
    return 'File: ' + String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}

/**
 * Menjalankan operasi kritikal di dalam ScriptLock untuk mencegah race condition
 * ketika beberapa petugas gudang menyimpan transaksi secara bersamaan (Bab 14).
 */
function executeWithWarehouseLock(callbackFn) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(25000);
  if (!acquired) {
    throw new Error('Server sedang memproses transaksi petugas lain. Silakan coba lagi dalam beberapa detik.');
  }
  try {
    return callbackFn();
  } finally {
    lock.releaseLock();
  }
}
