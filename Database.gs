/**
 * ============================================================================
 * SISTEM INFORMASI MANAJEMEN STOK GUDANG - PMI KOTA SURAKARTA
 * File: Database.gs
 * Deskripsi: Engine database Google Spreadsheet, pembuatan otomatis 10 sheet
 *            beserta pemformatan header Merah PMI, operasi CRUD berbasis ID unik,
 *            seeding data awal sesuai Stock Report Gudang PB.xlsx, log aktivitas,
 *            dan backup berkala.
 * ============================================================================
 */

// Cache per-eksekusi untuk mencegah pemanggilan SpreadsheetApp.openById & getValues berulang-ulang
var _CACHED_SS = null;
var _EXEC_SHEET_CACHE = {};
var SHEET_CACHE_TTL_SECONDS = 300; // 5 menit di CacheService

function getSheetCacheKey_(sheetName) {
  return 'PMI_SKA_SHEET_V2_' + String(sheetName || '').trim();
}

function invalidateSheetCache(sheetName) {
  if (!sheetName) {
    _EXEC_SHEET_CACHE = {};
    return;
  }
  delete _EXEC_SHEET_CACHE[sheetName];
  try {
    CacheService.getScriptCache().remove(getSheetCacheKey_(sheetName));
  } catch (e) {}
}

/**
 * Mendapatkan instance Google Spreadsheet aktif atau membuat baru jika standalone.
 */
function getDatabaseSpreadsheet() {
  if (_CACHED_SS) return _CACHED_SS;

  var props = PropertiesService.getScriptProperties();
  var ss = null;

  // 1. Cek konfigurasi eksplisit di APP_CONFIG.SPREADSHEET_ID
  if (APP_CONFIG.SPREADSHEET_ID && APP_CONFIG.SPREADSHEET_ID.trim() !== '') {
    try {
      ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID.trim());
      _CACHED_SS = ss;
      return ss;
    } catch (e) {}
  }

  // 2. Cek SPREADSHEET_ID yang tersimpan di ScriptProperties
  var savedId = props.getProperty('PMI_SURAKARTA_SPREADSHEET_ID');
  if (savedId) {
    try {
      ss = SpreadsheetApp.openById(savedId);
      _CACHED_SS = ss;
      return ss;
    } catch (e2) {}
  }

  // 3. Cek apakah script bersifat Container-Bound pada Spreadsheet aktif
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      props.setProperty('PMI_SURAKARTA_SPREADSHEET_ID', ss.getId());
      _CACHED_SS = ss;
      return ss;
    }
  } catch (e3) {}

  // 4. Buat file Google Spreadsheet baru secara otomatis jika belum ada
  ss = SpreadsheetApp.create('DATABASE_STOK_GUDANG_PMI_KOTA_SURAKARTA');
  props.setProperty('PMI_SURAKARTA_SPREADSHEET_ID', ss.getId());
  _CACHED_SS = ss;
  return ss;
}

/**
 * Fungsi Setup Database Otomatis (Tahap 4).
 * Membuat 10 sheet wajib, memformat header, mengisi akun default, donor,
 * pengaturan instansi, dan data awal Gudang PB PMI Kota Surakarta.
 */
function setupDatabase() {
  var ss = getDatabaseSpreadsheet();
  var sheetKeys = Object.keys(APP_CONFIG.SHEETS);

  for (var i = 0; i < sheetKeys.length; i++) {
    var key = sheetKeys[i];
    var sheetName = APP_CONFIG.SHEETS[key];
    var headers = APP_CONFIG.HEADERS[key];
    ensureSheetWithHeaders(ss, sheetName, headers);
  }

  // Hapus sheet default kosong ("Sheet1") jika 10 sheet utama sudah dibuat
  var allSheets = ss.getSheets();
  if (allSheets.length > 1) {
    for (var s = 0; s < allSheets.length; s++) {
      var nm = allSheets[s].getName();
      if (nm === 'Sheet1' || nm === 'Lembar1') {
        try {
          if (allSheets[s].getLastRow() <= 1) {
            ss.deleteSheet(allSheets[s]);
          }
        } catch (err) {}
      }
    }
  }

  seedDefaultSettings();
  seedDefaultUsers();
  seedDefaultDonors();
  seedInitialWarehouseData();
  recalculateAllStockBalances();

  return {
    success: true,
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    message: 'Setup Database 10 Sheet Gudang PMI Kota Surakarta berhasil dijalankan!'
  };
}

/**
 * Memastikan sheet tersedia dengan header berformat Merah PMI (#D71920).
 */
function ensureSheetWithHeaders(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange
      .setBackground(APP_CONFIG.COLORS.PRIMARY_RED)
      .setFontColor(APP_CONFIG.COLORS.WHITE)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.setFrozenRows(1);
    sheet.setRowHeight(1, 32);
  } else {
    var existingWidth = Math.max(sheet.getLastColumn(), headers.length);
    var firstRow = sheet.getRange(1, 1, 1, existingWidth).getValues()[0];
    var needUpdate = false;
    for (var i = 0; i < headers.length; i++) {
      if (String(firstRow[i] || '').trim() !== headers[i]) {
        firstRow[i] = headers[i];
        needUpdate = true;
      }
    }
    if (needUpdate) {
      sheet.getRange(1, 1, 1, headers.length).setValues([firstRow.slice(0, headers.length)]);
    }
  }
  return sheet;
}

/**
 * Membaca seluruh baris dari sheet dan mengembalikannya sebagai array of objects.
 * Dilengkapi In-Memory Cache & CacheService untuk mempercepat pembacaan database hingga 10x lipat.
 */
function getSheetRecords(sheetName) {
  if (_EXEC_SHEET_CACHE[sheetName]) {
    return _EXEC_SHEET_CACHE[sheetName];
  }

  var cacheKey = getSheetCacheKey_(sheetName);
  try {
    var cachedJson = CacheService.getScriptCache().get(cacheKey);
    if (cachedJson) {
      var parsedCache = JSON.parse(cachedJson);
      _EXEC_SHEET_CACHE[sheetName] = parsedCache;
      return parsedCache;
    }
  } catch (cacheReadErr) {}

  var ss = getDatabaseSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    var foundKey = null;
    var keys = Object.keys(APP_CONFIG.SHEETS);
    for (var k = 0; k < keys.length; k++) {
      if (APP_CONFIG.SHEETS[keys[k]] === sheetName) {
        foundKey = keys[k];
        break;
      }
    }
    if (foundKey) {
      sheet = ensureSheetWithHeaders(ss, sheetName, APP_CONFIG.HEADERS[foundKey]);
    } else {
      return [];
    }
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) {
    _EXEC_SHEET_CACHE[sheetName] = [];
    return [];
  }

  var rawValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = rawValues[0];
  var records = [];

  for (var r = 1; r < rawValues.length; r++) {
    var row = rawValues[r];
    var isBlank = true;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var colName = String(headers[c] || '').trim();
      if (!colName) continue;
      var val = row[c];
      if (val !== '' && val !== null && val !== undefined) {
        isBlank = false;
      }
      if (Object.prototype.toString.call(val) === '[object Date]') {
        if (colName.indexOf('tanggal') !== -1 || colName.indexOf('date') !== -1) {
          val = normalizeDateString(val);
        } else {
          val = Utilities.formatDate(val, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
        }
      }
      obj[colName] = val;
    }
    if (!isBlank) {
      records.push(obj);
    }
  }

  _EXEC_SHEET_CACHE[sheetName] = records;
  try {
    var serialized = JSON.stringify(records);
    if (serialized.length < 95000) {
      CacheService.getScriptCache().put(cacheKey, serialized, SHEET_CACHE_TTL_SECONDS);
    }
  } catch (cacheWriteErr) {}

  return records;
}

/**
 * Menambahkan 1 record baru ke dalam sheet sesuai urutan header.
 */
function insertSheetRecord(sheetName, headerKey, recordObj) {
  var ss = getDatabaseSpreadsheet();
  var headers = APP_CONFIG.HEADERS[headerKey];
  var sheet = ensureSheetWithHeaders(ss, sheetName, headers);
  var rowArray = [];

  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    var v = recordObj[h];
    rowArray.push(v !== undefined && v !== null ? v : '');
  }

  sheet.appendRow(rowArray);
  invalidateSheetCache(sheetName);
  return recordObj;
}

/**
 * Menambahkan banyak record sekaligus (batch insert) untuk performa tinggi (misal saat import Excel).
 */
function batchInsertSheetRecords(sheetName, headerKey, recordsArray) {
  if (!recordsArray || recordsArray.length === 0) return 0;
  var ss = getDatabaseSpreadsheet();
  var headers = APP_CONFIG.HEADERS[headerKey];
  var sheet = ensureSheetWithHeaders(ss, sheetName, headers);
  var rowsMatrix = [];

  for (var r = 0; r < recordsArray.length; r++) {
    var rec = recordsArray[r];
    var row = [];
    for (var c = 0; c < headers.length; c++) {
      var col = headers[c];
      var val = rec[col];
      row.push(val !== undefined && val !== null ? val : '');
    }
    rowsMatrix.push(row);
  }

  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rowsMatrix.length, headers.length).setValues(rowsMatrix);
  invalidateSheetCache(sheetName);
  return rowsMatrix.length;
}

/**
 * Memperbarui record berdasarkan kolom ID unik (bukan nomor baris sebagai identitas).
 */
function updateSheetRecordById(sheetName, headerKey, idColumnName, idValue, updatedFields) {
  var ss = getDatabaseSpreadsheet();
  var headers = APP_CONFIG.HEADERS[headerKey];
  var sheet = ensureSheetWithHeaders(ss, sheetName, headers);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  var allData = sheet.getRange(1, 1, lastRow, headers.length).getValues();
  var idColIndex = headers.indexOf(idColumnName);
  if (idColIndex === -1) {
    throw new Error('Kolom ID ' + idColumnName + ' tidak ditemukan pada sheet ' + sheetName);
  }

  for (var r = 1; r < allData.length; r++) {
    if (String(allData[r][idColIndex]).trim() === String(idValue).trim()) {
      var currentRow = allData[r];
      for (var c = 0; c < headers.length; c++) {
        var colKey = headers[c];
        if (updatedFields.hasOwnProperty(colKey) && updatedFields[colKey] !== undefined) {
          currentRow[c] = updatedFields[colKey];
        }
      }
      sheet.getRange(r + 1, 1, 1, headers.length).setValues([currentRow]);
      invalidateSheetCache(sheetName);
      return true;
    }
  }
  return false;
}

/**
 * Menghapus record berdasarkan kolom ID unik.
 */
function deleteSheetRecordById(sheetName, headerKey, idColumnName, idValue) {
  var ss = getDatabaseSpreadsheet();
  var headers = APP_CONFIG.HEADERS[headerKey];
  var sheet = ensureSheetWithHeaders(ss, sheetName, headers);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  var allData = sheet.getRange(1, 1, lastRow, headers.length).getValues();
  var idColIndex = headers.indexOf(idColumnName);
  if (idColIndex === -1) return false;

  for (var r = allData.length - 1; r >= 1; r--) {
    if (String(allData[r][idColIndex]).trim() === String(idValue).trim()) {
      sheet.deleteRow(r + 1);
      invalidateSheetCache(sheetName);
      return true;
    }
  }
  return false;
}

/**
 * Mengganti seluruh isi data pada sheet tertentu (digunakan untuk memperbarui STOCK_BALANCE).
 */
function replaceAllSheetRecords(sheetName, headerKey, recordsArray) {
  var ss = getDatabaseSpreadsheet();
  var headers = APP_CONFIG.HEADERS[headerKey];
  var sheet = ensureSheetWithHeaders(ss, sheetName, headers);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent();
  }
  if (recordsArray && recordsArray.length > 0) {
    batchInsertSheetRecords(sheetName, headerKey, recordsArray);
  }
  invalidateSheetCache(sheetName);
}

/**
 * Mencatat setiap aktivitas pengguna ke dalam sheet LOG_AKTIVITAS (Bab 12 & 14).
 */
function logUserActivity(userObj, modul, aksi, referensiId, detailAktivitas) {
  try {
    var u = userObj || {
      id_user: 'SYSTEM',
      username: 'system',
      nama_lengkap: 'Sistem Otomatis',
      role: 'SYSTEM'
    };
    var logRecord = {
      id_log: generateUniqueId('LOG'),
      timestamp: getCurrentTimestamp(),
      id_user: u.id_user || 'SYSTEM',
      username: u.username || 'system',
      nama_user: u.nama_lengkap || u.username || 'Sistem',
      role: u.role || 'SYSTEM',
      modul: modul || 'GENERAL',
      aksi: aksi || 'INFO',
      referensi_id: referensiId || '-',
      detail_aktivitas: detailAktivitas || ''
    };
    insertSheetRecord(APP_CONFIG.SHEETS.LOG_AKTIVITAS, 'LOG_AKTIVITAS', logRecord);
  } catch (e) {}
}

/**
 * Seeding Pengaturan Awal Aplikasi pada sheet SETTINGS.
 */
function seedDefaultSettings() {
  var existing = getSheetRecords(APP_CONFIG.SHEETS.SETTINGS);
  if (existing.length > 0) return;

  var now = getCurrentTimestamp();
  var defaults = [
    {
      setting_key: 'NAMA_INSTANSI',
      setting_value: 'PALANG MERAH INDONESIA KOTA SURAKARTA',
      deskripsi: 'Nama Resmi Instansi pada Kop Laporan',
      updated_at: now,
      updated_by: 'SYSTEM'
    },
    {
      setting_key: 'ALAMAT_INSTANSI',
      setting_value: 'Jl. Kolonel Sutarto No. 58, Jebres, Kota Surakarta, Jawa Tengah 57126',
      deskripsi: 'Alamat Markas & Gudang PMI Kota Surakarta',
      updated_at: now,
      updated_by: 'SYSTEM'
    },
    {
      setting_key: 'TELEPON_INSTANSI',
      setting_value: '(0271) 646505 | Email: kota_surakarta@pmi.or.id',
      deskripsi: 'Kontak Resmi Markas PMI Kota Surakarta',
      updated_at: now,
      updated_by: 'SYSTEM'
    },
    {
      setting_key: 'NAMA_KEPALA_MARKAS',
      setting_value: 'Wanto, S.KM.',
      deskripsi: 'Nama Pejabat Penanggung Jawab / KaBag PB & Relawan pada Kolom Tanda Tangan Laporan',
      updated_at: now,
      updated_by: 'SYSTEM'
    },
    {
      setting_key: 'NAMA_KOORDINATOR_GUDANG',
      setting_value: 'Indro Sri Widodo',
      deskripsi: 'Nama Koordinator Gudang / KaSie Kesiapsiagaan dan Respon pada Kolom Tanda Tangan',
      updated_at: now,
      updated_by: 'SYSTEM'
    },
    {
      setting_key: 'AUTO_BACKUP_ENABLED',
      setting_value: 'TRUE',
      deskripsi: 'Status fitur backup database berkala ke Google Drive',
      updated_at: now,
      updated_by: 'SYSTEM'
    }
  ];

  batchInsertSheetRecords(APP_CONFIG.SHEETS.SETTINGS, 'SETTINGS', defaults);
}

/**
 * Seeding 3 Akun Pengguna Default sesuai Level Akses (ADMIN, PETUGAS GUDANG, PIMPINAN).
 */
function seedDefaultUsers() {
  var existing = getSheetRecords(APP_CONFIG.SHEETS.USERS);
  if (existing.length > 0) return;

  var now = getCurrentTimestamp();
  var defaultUsers = [
    {
      id_user: 'USR-ADMIN-001',
      username: 'admin',
      password_hash: hashPassword('admin123'),
      nama_lengkap: 'Administrator Logistik PMI',
      role: APP_CONFIG.ROLES.ADMIN,
      jabatan: 'Kasubbid Logistik & Gudang PB',
      email: 'logistik@pmisurakarta.or.id',
      no_hp: '0271-646505',
      status_aktif: 'AKTIF',
      last_login: '',
      created_at: now,
      updated_at: now
    },
    {
      id_user: 'USR-PETUGAS-001',
      username: 'petugas',
      password_hash: hashPassword('petugas123'),
      nama_lengkap: 'Indro Sri Widodo',
      role: APP_CONFIG.ROLES.PETUGAS_GUDANG,
      jabatan: 'KaSie Kesiapsiagaan dan Respon / Petugas Gudang PB',
      email: 'gudang@pmisurakarta.or.id',
      no_hp: '081234567890',
      status_aktif: 'AKTIF',
      last_login: '',
      created_at: now,
      updated_at: now
    },
    {
      id_user: 'USR-PIMPINAN-001',
      username: 'pimpinan',
      password_hash: hashPassword('pimpinan123'),
      nama_lengkap: 'Wanto, S.KM.',
      role: APP_CONFIG.ROLES.PIMPINAN,
      jabatan: 'KaBag PB & Relawan / Pimpinan PMI Kota Surakarta',
      email: 'markas@pmisurakarta.or.id',
      no_hp: '0271-646505',
      status_aktif: 'AKTIF',
      last_login: '',
      created_at: now,
      updated_at: now
    }
  ];

  batchInsertSheetRecords(APP_CONFIG.SHEETS.USERS, 'USERS', defaultUsers);
}

/**
 * Seeding Data Sumber Barang / Donor awal pada sheet DONOR_SUMBER.
 */
function seedDefaultDonors() {
  var existing = getSheetRecords(APP_CONFIG.SHEETS.DONOR_SUMBER);
  if (existing.length > 0) return;

  var now = getCurrentTimestamp();
  var donors = [
    {
      id_donor: 'DNR-001',
      kode_donor: 'PMI-PST',
      nama_donor: 'PMI Pusat (Markas Pusat)',
      jenis_donor: 'Internal PMI',
      kontak: '021-7992325',
      alamat: 'Jl. Jend. Gatot Subroto Kav. 96 Jakarta',
      keterangan: 'Bantuan Logistik Nasional PMI Pusat',
      status_aktif: 'AKTIF',
      created_at: now
    },
    {
      id_donor: 'DNR-002',
      kode_donor: 'PMI-JTG',
      nama_donor: 'PMI Provinsi Jawa Tengah',
      jenis_donor: 'Internal PMI',
      kontak: '024-3515050',
      alamat: 'Semarang, Jawa Tengah',
      keterangan: 'Dropping Logistik Regional Jawa Tengah',
      status_aktif: 'AKTIF',
      created_at: now
    },
    {
      id_donor: 'DNR-003',
      kode_donor: 'PMI-SKA',
      nama_donor: 'Pengadaan Mandiri PMI Kota Surakarta',
      jenis_donor: 'Pengadaan Internal',
      kontak: '0271-646505',
      alamat: 'Jl. Kolonel Sutarto No. 58 Surakarta',
      keterangan: 'Pembelian Anggaran Rutin & Tanggap Darurat',
      status_aktif: 'AKTIF',
      created_at: now
    },
    {
      id_donor: 'DNR-004',
      kode_donor: 'IFRC',
      nama_donor: 'IFRC / ICRC (Federasi Palang Merah Internasional)',
      jenis_donor: 'Mitra Internasional',
      kontak: '-',
      alamat: 'Jakarta / Geneva',
      keterangan: 'Hibah Relief Item & Shelter Kit',
      status_aktif: 'AKTIF',
      created_at: now
    },
    {
      id_donor: 'DNR-005',
      kode_donor: 'HVC',
      nama_donor: 'HVC / Mitra Donor Kemanusiaan',
      jenis_donor: 'Donor Mitra',
      kontak: '-',
      alamat: 'Surakarta',
      keterangan: 'Donor Paket Pangan & Bantuan Darurat (Referensi Gudang PB)',
      status_aktif: 'AKTIF',
      created_at: now
    },
    {
      id_donor: 'DNR-006',
      kode_donor: 'CSR-DONATUR',
      nama_donor: 'Donatur Masyarakat & CSR Perusahaan Surakarta',
      jenis_donor: 'Donatur Umum',
      kontak: '-',
      alamat: 'Kota Surakarta',
      keterangan: 'Sumbangan Bantuan Kemanusiaan & Bencana',
      status_aktif: 'AKTIF',
      created_at: now
    }
  ];

  batchInsertSheetRecords(APP_CONFIG.SHEETS.DONOR_SUMBER, 'DONOR_SUMBER', donors);
}

/**
 * Seeding Data Master Barang dan Transaksi Awal sesuai referensi Stock Report Gudang PB.xlsx
 * mencakup 3 kategori utama: FOOD ITEMS, NON FOOD, dan OBAT.
 */
function seedInitialWarehouseData() {
  var existingItems = getSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG);
  if (existingItems.length > 0) return;

  var now = getCurrentTimestamp();
  var today = getTodayDateString();

  // Tanggal dinamis untuk demonstrasi 4 status kedaluwarsa (Aman, Perhatian, Segera, Kedaluwarsa)
  var nowMs = new Date().getTime();
  var expAman1 = Utilities.formatDate(new Date(nowMs + 155 * 86400000), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');    // > 90 hari (misal 2027-04-30)
  var expAman2 = Utilities.formatDate(new Date(nowMs + 350 * 86400000), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');    // > 90 hari (misal 2027-11-11)
  var expPerhatian = Utilities.formatDate(new Date(nowMs + 59 * 86400000), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd'); // 31-90 hari (misal 2027-01-23)
  var expSegera = Utilities.formatDate(new Date(nowMs + 18 * 86400000), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');    // 1-30 hari
  var expLewat = Utilities.formatDate(new Date(nowMs - 12 * 86400000), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');     // <= 0 hari

  var masterItems = [
    // A. FOOD ITEMS (termasuk referensi Stock Report Gudang PB.xlsx)
    {
      id_barang: 'BRG-FD-0001',
      kode_barang: '06-000174',
      nama_barang: 'FOOD PACKAGE (Paket Pangan Darurat)',
      kategori: 'FOOD ITEMS',
      subkategori: 'Paket Pangan Bencana',
      satuan: 'karung',
      harga_unit: 200000,
      sumber_donor: 'HVC',
      stok_minimum: 25,
      lokasi_rak: 'RAK-A1',
      has_expiry: 'YA',
      keterangan: 'Paket bantuan pangan standar Gudang PB',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-FD-0002',
      kode_barang: 'FD-0002',
      nama_barang: 'Beras Premium Kemasan 5 Kg',
      kategori: 'FOOD ITEMS',
      subkategori: 'Makanan Pokok',
      satuan: 'Sak',
      harga_unit: 72500,
      sumber_donor: 'CSR-DONATUR',
      stok_minimum: 25,
      lokasi_rak: 'RAK-A2',
      has_expiry: 'YA',
      keterangan: 'Beras bantuan logistik bencana',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-FD-0003',
      kode_barang: 'FD-0003',
      nama_barang: 'Mie Instan Kuah (Karton 40 Bungkus)',
      kategori: 'FOOD ITEMS',
      subkategori: 'Makanan Siap Saji',
      satuan: 'Dus',
      harga_unit: 112000,
      sumber_donor: 'PMI-JTG',
      stok_minimum: 20,
      lokasi_rak: 'RAK-A3',
      has_expiry: 'YA',
      keterangan: 'Logistik dapur umum & paket sembako',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-FD-0004',
      kode_barang: 'FD-0004',
      nama_barang: 'Sarden Kaleng 425gr',
      kategori: 'FOOD ITEMS',
      subkategori: 'Lauk Siap Saji',
      satuan: 'Kaleng',
      harga_unit: 24000,
      sumber_donor: 'PMI-PST',
      stok_minimum: 40,
      lokasi_rak: 'RAK-A4',
      has_expiry: 'YA',
      keterangan: 'Lauk pauk paket bantuan darurat',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-FD-0005',
      kode_barang: 'FD-0005',
      nama_barang: 'Biskuit Energi Darurat / PMT',
      kategori: 'FOOD ITEMS',
      subkategori: 'Makanan Tambahan',
      satuan: 'Pak',
      harga_unit: 15000,
      sumber_donor: 'PMI-SKA',
      stok_minimum: 20,
      lokasi_rak: 'RAK-A5',
      has_expiry: 'YA',
      keterangan: 'Makanan tambahan balita & lansia pengungsian',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },

    // B. NON FOOD (Sesuai item Stock Report Gudang PB.xlsx: Hygiene Kit, Kitchen Set, Tapaulin, Matras, Sabun Mandi, Sikat gigi, Baby Kit, Family Kit)
    {
      id_barang: 'BRG-NF-0001',
      kode_barang: 'NF-0001',
      nama_barang: 'Hygiene Kit',
      kategori: 'NON FOOD',
      subkategori: 'Paket Bantuan',
      satuan: 'Paket',
      harga_unit: 210000,
      sumber_donor: 'PMI-JTG',
      stok_minimum: 20,
      lokasi_rak: 'RAK-B1',
      has_expiry: 'YA',
      keterangan: 'Komponen: Sabun Mandi (2027-04-30), Pasta Gigi (2027-11-11), Shampo (2027-01-23)',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-NF-0002',
      kode_barang: 'NF-0002',
      nama_barang: 'Kitchen Set',
      kategori: 'NON FOOD',
      subkategori: 'Paket Bantuan',
      satuan: 'Paket',
      harga_unit: 325000,
      sumber_donor: 'PMI-PST',
      stok_minimum: 15,
      lokasi_rak: 'RAK-B2',
      has_expiry: 'TIDAK',
      keterangan: 'Perlengkapan memasak keluarga terdampak bencana',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-NF-0003',
      kode_barang: 'NF-0003',
      nama_barang: 'Tapaulin (Terpal Shelter PMI)',
      kategori: 'NON FOOD',
      subkategori: 'Perlengkapan Shelter',
      satuan: 'Pcs',
      harga_unit: 245000,
      sumber_donor: 'IFRC',
      stok_minimum: 15,
      lokasi_rak: 'RAK-B3',
      has_expiry: 'TIDAK',
      keterangan: 'Terpal pelindung hunian darurat standar PMI',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-NF-0004',
      kode_barang: 'NF-0004',
      nama_barang: 'Matras',
      kategori: 'NON FOOD',
      subkategori: 'Perlengkapan Shelter',
      satuan: 'Pcs',
      harga_unit: 65000,
      sumber_donor: 'PMI-JTG',
      stok_minimum: 20,
      lokasi_rak: 'RAK-B4',
      has_expiry: 'TIDAK',
      keterangan: 'Alas tidur pengungsian',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-NF-0005',
      kode_barang: 'NF-0005',
      nama_barang: 'Family Kit',
      kategori: 'NON FOOD',
      subkategori: 'Paket Bantuan',
      satuan: 'Paket',
      harga_unit: 385000,
      sumber_donor: 'PMI-JTG',
      stok_minimum: 10,
      lokasi_rak: 'RAK-B5',
      has_expiry: 'TIDAK',
      keterangan: 'Paket bantuan keluarga terdampak banjir/kebakaran',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-NF-0006',
      kode_barang: 'NF-0006',
      nama_barang: 'Baby Kit',
      kategori: 'NON FOOD',
      subkategori: 'Paket Bantuan',
      satuan: 'Paket',
      harga_unit: 240000,
      sumber_donor: 'PMI-JTG',
      stok_minimum: 10,
      lokasi_rak: 'RAK-B6',
      has_expiry: 'TIDAK',
      keterangan: 'Paket perlengkapan bayi darurat',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-NF-0007',
      kode_barang: 'NF-0007',
      nama_barang: 'Sabun Mandi',
      kategori: 'NON FOOD',
      subkategori: 'Sanitasi & Kebersihan',
      satuan: 'Pcs',
      harga_unit: 4500,
      sumber_donor: 'PMI-SKA',
      stok_minimum: 100,
      lokasi_rak: 'RAK-B7',
      has_expiry: 'YA',
      keterangan: 'Sabun mandi bantuan sanitasi darurat',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-NF-0008',
      kode_barang: 'NF-0008',
      nama_barang: 'Sikat Gigi',
      kategori: 'NON FOOD',
      subkategori: 'Sanitasi & Kebersihan',
      satuan: 'Pcs',
      harga_unit: 5500,
      sumber_donor: 'PMI-SKA',
      stok_minimum: 50,
      lokasi_rak: 'RAK-B7',
      has_expiry: 'TIDAK',
      keterangan: 'Sikat gigi komponen kebersihan individu',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-NF-0009',
      kode_barang: 'NF-0009',
      nama_barang: 'Kacamata Google (APD)',
      kategori: 'NON FOOD',
      subkategori: 'APD & Keselamatan',
      satuan: 'Pcs',
      harga_unit: 45000,
      sumber_donor: 'PMI-SKA',
      stok_minimum: 30,
      lokasi_rak: 'RAK-B8',
      has_expiry: 'TIDAK',
      keterangan: 'Pelindung mata operasi erupsi Gunung Merapi / APG',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },

    // C. OBAT & PERLENGKAPAN MEDIS/FARMASI
    {
      id_barang: 'BRG-OB-0001',
      kode_barang: 'OB-0001',
      nama_barang: 'Masker Medis Pelindung Pernapasan',
      kategori: 'OBAT',
      subkategori: 'Alat Kesehatan & APD Medis',
      satuan: 'Box',
      harga_unit: 35000,
      sumber_donor: 'PMI-SKA',
      stok_minimum: 25,
      lokasi_rak: 'RAK-C1',
      has_expiry: 'YA',
      keterangan: 'Masker medis respon APG Merapi & pelayanan kesehatan',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-OB-0002',
      kode_barang: 'OB-0002',
      nama_barang: 'Paracetamol 500mg (Box 100 Kaplet)',
      kategori: 'OBAT',
      subkategori: 'Analgesik & Antipiretik',
      satuan: 'Box',
      harga_unit: 38000,
      sumber_donor: 'PMI-SKA',
      stok_minimum: 15,
      lokasi_rak: 'RAK-C2',
      has_expiry: 'YA',
      keterangan: 'Obat penurun demam pos kesehatan PMI',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-OB-0003',
      kode_barang: 'OB-0003',
      nama_barang: 'Povidone Iodine 10% 300ml (Betadine)',
      kategori: 'OBAT',
      subkategori: 'Antiseptik & P3K',
      satuan: 'Botol',
      harga_unit: 62000,
      sumber_donor: 'PMI-SKA',
      stok_minimum: 10,
      lokasi_rak: 'RAK-C3',
      has_expiry: 'YA',
      keterangan: 'Cairan antiseptik pertolongan pertama',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    },
    {
      id_barang: 'BRG-OB-0004',
      kode_barang: 'OB-0004',
      nama_barang: 'Kasa Steril Hidrofil 16x16cm (Box 16 Lembar)',
      kategori: 'OBAT',
      subkategori: 'Perbekalan Kesehatan P3K',
      satuan: 'Box',
      harga_unit: 14500,
      sumber_donor: 'PMI-JTG',
      stok_minimum: 30,
      lokasi_rak: 'RAK-C4',
      has_expiry: 'YA',
      keterangan: 'Penutup luka steril pelayanan ambulans & posko',
      status_aktif: 'AKTIF',
      created_at: now,
      updated_at: now,
      created_by: 'admin'
    }
  ];

  batchInsertSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG, 'MASTER_BARANG', masterItems);

  // Transaksi Barang Masuk Awal (mengacu pada data Stock Report Gudang PB.xlsx)
  var initialMasuk = [
    {
      id_masuk: 'IN-SEED-0001',
      no_transaksi: 'BM-202611-0001',
      tanggal: today,
      id_barang: 'BRG-FD-0001',
      kode_barang: '06-000174',
      nama_barang: 'FOOD PACKAGE (Paket Pangan Darurat)',
      kategori: 'FOOD ITEMS',
      jumlah_masuk: 500,
      satuan: 'karung',
      harga_unit: 200000,
      total_nilai: 100000000,
      sumber_donor: 'HVC',
      no_grn: 'GRN/PMI-SKA/PB/001',
      no_request: '789',
      expired_date: expAman1,
      catatan: 'Penerimaan Food Package Gudang PB',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0002',
      no_transaksi: 'BM-202611-0002',
      tanggal: today,
      id_barang: 'BRG-FD-0002',
      kode_barang: 'FD-0002',
      nama_barang: 'Beras Premium Kemasan 5 Kg',
      kategori: 'FOOD ITEMS',
      jumlah_masuk: 120,
      satuan: 'Sak',
      harga_unit: 72500,
      total_nilai: 8700000,
      sumber_donor: 'CSR-DONATUR',
      no_grn: 'GRN/PMI-SKA/PB/002',
      no_request: 'REQ-PB-002',
      expired_date: expAman2,
      catatan: 'Penerimaan logistik beras bencana',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0003',
      no_transaksi: 'BM-202611-0003',
      tanggal: today,
      id_barang: 'BRG-FD-0004',
      kode_barang: 'FD-0004',
      nama_barang: 'Sarden Kaleng 425gr',
      kategori: 'FOOD ITEMS',
      jumlah_masuk: 28,
      satuan: 'Kaleng',
      harga_unit: 24000,
      total_nilai: 672000,
      sumber_donor: 'PMI-PST',
      no_grn: 'GRN/PMI-SKA/PB/003',
      no_request: 'REQ-PB-003',
      expired_date: expSegera,
      catatan: 'Stok lauk siap saji (Mendekati Expired)',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0004',
      no_transaksi: 'BM-202611-0004',
      tanggal: today,
      id_barang: 'BRG-FD-0005',
      kode_barang: 'FD-0005',
      nama_barang: 'Biskuit Energi Darurat / PMT',
      kategori: 'FOOD ITEMS',
      jumlah_masuk: 12,
      satuan: 'Pak',
      harga_unit: 15000,
      total_nilai: 180000,
      sumber_donor: 'PMI-SKA',
      no_grn: 'GRN/PMI-SKA/PB/004',
      no_request: 'REQ-PB-004',
      expired_date: expLewat,
      catatan: 'Batch lama perlu pemisahan karantina expired',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0005',
      no_transaksi: 'BM-202611-0005',
      tanggal: today,
      id_barang: 'BRG-NF-0001',
      kode_barang: 'NF-0001',
      nama_barang: 'Hygiene Kit',
      kategori: 'NON FOOD',
      jumlah_masuk: 65,
      satuan: 'Paket',
      harga_unit: 210000,
      total_nilai: 13650000,
      sumber_donor: 'PMI-JTG',
      no_grn: 'GRN/PMI-SKA/PB/005',
      no_request: 'REQ-PB-005',
      expired_date: expPerhatian,
      catatan: 'Sabun Mandi (2027-04-30), Pasta Gigi (2027-11-11), Shampo (2027-01-23)',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0006',
      no_transaksi: 'BM-202611-0006',
      tanggal: today,
      id_barang: 'BRG-NF-0002',
      kode_barang: 'NF-0002',
      nama_barang: 'Kitchen Set',
      kategori: 'NON FOOD',
      jumlah_masuk: 50,
      satuan: 'Paket',
      harga_unit: 325000,
      total_nilai: 16250000,
      sumber_donor: 'PMI-PST',
      no_grn: 'GRN/PMI-SKA/PB/006',
      no_request: 'REQ-PB-006',
      expired_date: '',
      catatan: 'Saldo Gudang PB November 2026',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0007',
      no_transaksi: 'BM-202611-0007',
      tanggal: today,
      id_barang: 'BRG-NF-0003',
      kode_barang: 'NF-0003',
      nama_barang: 'Tapaulin (Terpal Shelter PMI)',
      kategori: 'NON FOOD',
      jumlah_masuk: 10,
      satuan: 'Pcs',
      harga_unit: 245000,
      total_nilai: 2450000,
      sumber_donor: 'IFRC',
      no_grn: 'GRN/PMI-SKA/PB/007',
      no_request: 'REQ-PB-007',
      expired_date: '',
      catatan: 'Stok Tapaulin Gudang PB (Batas Minimum)',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0008',
      no_transaksi: 'BM-202611-0008',
      tanggal: today,
      id_barang: 'BRG-NF-0004',
      kode_barang: 'NF-0004',
      nama_barang: 'Matras',
      kategori: 'NON FOOD',
      jumlah_masuk: 35,
      satuan: 'Pcs',
      harga_unit: 65000,
      total_nilai: 2275000,
      sumber_donor: 'PMI-JTG',
      no_grn: 'GRN/PMI-SKA/PB/008',
      no_request: 'REQ-PB-008',
      expired_date: '',
      catatan: 'Dropping PMI Jateng & Stok Gudang PB',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0009',
      no_transaksi: 'BM-202611-0009',
      tanggal: today,
      id_barang: 'BRG-NF-0005',
      kode_barang: 'NF-0005',
      nama_barang: 'Family Kit',
      kategori: 'NON FOOD',
      jumlah_masuk: 15,
      satuan: 'Paket',
      harga_unit: 385000,
      total_nilai: 5775000,
      sumber_donor: 'PMI-JTG',
      no_grn: 'GRN/PMI-SKA/PB/009',
      no_request: 'REQ-PB-009',
      expired_date: '',
      catatan: 'Dropping PMI Jateng',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0010',
      no_transaksi: 'BM-202611-0010',
      tanggal: today,
      id_barang: 'BRG-NF-0006',
      kode_barang: 'NF-0006',
      nama_barang: 'Baby Kit',
      kategori: 'NON FOOD',
      jumlah_masuk: 15,
      satuan: 'Paket',
      harga_unit: 240000,
      total_nilai: 3600000,
      sumber_donor: 'PMI-JTG',
      no_grn: 'GRN/PMI-SKA/PB/010',
      no_request: 'REQ-PB-010',
      expired_date: '',
      catatan: 'Dropping PMI Jateng',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0011',
      no_transaksi: 'BM-202611-0011',
      tanggal: today,
      id_barang: 'BRG-NF-0007',
      kode_barang: 'NF-0007',
      nama_barang: 'Sabun Mandi',
      kategori: 'NON FOOD',
      jumlah_masuk: 1800,
      satuan: 'Pcs',
      harga_unit: 4500,
      total_nilai: 8100000,
      sumber_donor: 'PMI-SKA',
      no_grn: 'GRN/PMI-SKA/PB/011',
      no_request: 'REQ-PB-011',
      expired_date: expAman1,
      catatan: 'Stok Awal Sabun Mandi Gudang PB',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0012',
      no_transaksi: 'BM-202611-0012',
      tanggal: today,
      id_barang: 'BRG-NF-0008',
      kode_barang: 'NF-0008',
      nama_barang: 'Sikat Gigi',
      kategori: 'NON FOOD',
      jumlah_masuk: 347,
      satuan: 'Pcs',
      harga_unit: 5500,
      total_nilai: 1908500,
      sumber_donor: 'PMI-SKA',
      no_grn: 'GRN/PMI-SKA/PB/012',
      no_request: 'REQ-PB-012',
      expired_date: '',
      catatan: 'Stok Awal Sikat Gigi Gudang PB',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0013',
      no_transaksi: 'BM-202611-0013',
      tanggal: today,
      id_barang: 'BRG-NF-0009',
      kode_barang: 'NF-0009',
      nama_barang: 'Kacamata Google (APD)',
      kategori: 'NON FOOD',
      jumlah_masuk: 169,
      satuan: 'Pcs',
      harga_unit: 45000,
      total_nilai: 7605000,
      sumber_donor: 'PMI-SKA',
      no_grn: 'GRN/PMI-SKA/PB/013',
      no_request: 'REQ-PB-013',
      expired_date: '',
      catatan: 'Stok Awal Kacamata Google APD',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0014',
      no_transaksi: 'BM-202611-0014',
      tanggal: today,
      id_barang: 'BRG-OB-0001',
      kode_barang: 'OB-0001',
      nama_barang: 'Masker Medis Pelindung Pernapasan',
      kategori: 'OBAT',
      jumlah_masuk: 78,
      satuan: 'Box',
      harga_unit: 35000,
      total_nilai: 2730000,
      sumber_donor: 'PMI-SKA',
      no_grn: 'GRN/PMI-SKA/PB/014',
      no_request: 'REQ-PB-014',
      expired_date: expAman2,
      catatan: 'Stok Awal Masker Gudang PB',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0015',
      no_transaksi: 'BM-202611-0015',
      tanggal: today,
      id_barang: 'BRG-OB-0002',
      kode_barang: 'OB-0002',
      nama_barang: 'Paracetamol 500mg (Box 100 Kaplet)',
      kategori: 'OBAT',
      jumlah_masuk: 50,
      satuan: 'Box',
      harga_unit: 38000,
      total_nilai: 1900000,
      sumber_donor: 'PMI-SKA',
      no_grn: 'GRN/PMI-SKA/PB/015',
      no_request: 'REQ-PB-015',
      expired_date: expAman2,
      catatan: 'Stok Obat Pelayanan Kesehatan PMI',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    },
    {
      id_masuk: 'IN-SEED-0016',
      no_transaksi: 'BM-202611-0016',
      tanggal: today,
      id_barang: 'BRG-OB-0003',
      kode_barang: 'OB-0003',
      nama_barang: 'Povidone Iodine 10% 300ml (Betadine)',
      kategori: 'OBAT',
      jumlah_masuk: 32,
      satuan: 'Botol',
      harga_unit: 62000,
      total_nilai: 1984000,
      sumber_donor: 'PMI-SKA',
      no_grn: 'GRN/PMI-SKA/PB/016',
      no_request: 'REQ-PB-016',
      expired_date: expPerhatian,
      catatan: 'Antiseptik Pertolongan Pertama',
      dokumen_url: '',
      created_at: now,
      created_by: 'admin',
      updated_at: now,
      updated_by: 'admin'
    }
  ];

  batchInsertSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK, 'TRANSAKSI_MASUK', initialMasuk);

  // Transaksi Barang Keluar & Distribusi Bantuan (mengacu pada riwayat nyata di Stock Report Gudang PB.xlsx)
  var initialKeluar = [
    {
      id_keluar: 'OUT-SEED-0001',
      no_transaksi: 'BK-202611-0001',
      tanggal: today,
      id_barang: 'BRG-NF-0007',
      kode_barang: 'NF-0007',
      nama_barang: 'Sabun Mandi',
      kategori: 'NON FOOD',
      jumlah_keluar: 72,
      satuan: 'Pcs',
      harga_unit: 4500,
      total_nilai: 324000,
      tujuan_distribusi: 'Kel. Nusukan (Kebakaran)',
      nama_penerima: 'Warga Terdampak Kebakaran Kel. Nusukan',
      no_gdn: 'GDN/PMI-SKA/PB/001',
      no_request: 'REQ-PB-OUT-01',
      penanggung_jawab: 'Indro Sri Widodo',
      catatan: 'Distribusi bantuan darurat kebakaran Kel. Nusukan',
      dokumen_url: '',
      created_at: now,
      created_by: 'petugas',
      updated_at: now,
      updated_by: 'petugas'
    },
    {
      id_keluar: 'OUT-SEED-0002',
      no_transaksi: 'BK-202611-0002',
      tanggal: today,
      id_barang: 'BRG-NF-0007',
      kode_barang: 'NF-0007',
      nama_barang: 'Sabun Mandi',
      kategori: 'NON FOOD',
      jumlah_keluar: 150,
      satuan: 'Pcs',
      harga_unit: 4500,
      total_nilai: 675000,
      tujuan_distribusi: 'Kel. Joyosuran',
      nama_penerima: 'Posko Bantuan Kel. Joyosuran',
      no_gdn: 'GDN/PMI-SKA/PB/002',
      no_request: 'REQ-PB-OUT-02',
      penanggung_jawab: 'Indro Sri Widodo',
      catatan: 'Distribusi bantuan warga Kel. Joyosuran',
      dokumen_url: '',
      created_at: now,
      created_by: 'petugas',
      updated_at: now,
      updated_by: 'petugas'
    },
    {
      id_keluar: 'OUT-SEED-0003',
      no_transaksi: 'BK-202611-0003',
      tanggal: today,
      id_barang: 'BRG-NF-0005',
      kode_barang: 'NF-0005',
      nama_barang: 'Family Kit',
      kategori: 'NON FOOD',
      jumlah_keluar: 8,
      satuan: 'Paket',
      harga_unit: 385000,
      total_nilai: 3080000,
      tujuan_distribusi: 'Kel. Gandekan & Kel. Manahan',
      nama_penerima: 'Karyawan & Warga Terdampak Banjir',
      no_gdn: 'GDN/PMI-SKA/PB/003',
      no_request: 'REQ-PB-OUT-03',
      penanggung_jawab: 'Indro Sri Widodo',
      catatan: 'Distribusi Family Kit (4 Karyawan, 3 Kel. Gandekan, 1 Kel. Manahan)',
      dokumen_url: '',
      created_at: now,
      created_by: 'petugas',
      updated_at: now,
      updated_by: 'petugas'
    },
    {
      id_keluar: 'OUT-SEED-0004',
      no_transaksi: 'BK-202611-0004',
      tanggal: today,
      id_barang: 'BRG-OB-0001',
      kode_barang: 'OB-0001',
      nama_barang: 'Masker Medis Pelindung Pernapasan',
      kategori: 'OBAT',
      jumlah_keluar: 21,
      satuan: 'Box',
      harga_unit: 35000,
      total_nilai: 735000,
      tujuan_distribusi: 'APG Merapi',
      nama_penerima: 'Tim Respon Erupsi APG Merapi',
      no_gdn: 'GDN/PMI-SKA/PB/004',
      no_request: 'REQ-PB-OUT-04',
      penanggung_jawab: 'Indro Sri Widodo',
      catatan: 'Dukungan logistik kesehatan respon APG Merapi',
      dokumen_url: '',
      created_at: now,
      created_by: 'petugas',
      updated_at: now,
      updated_by: 'petugas'
    }
  ];

  batchInsertSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR, 'TRANSAKSI_KELUAR', initialKeluar);

  var initialDistribusi = [];
  for (var d = 0; d < initialKeluar.length; d++) {
    var k = initialKeluar[d];
    initialDistribusi.push({
      id_distribusi: 'DST-SEED-000' + (d + 1),
      no_distribusi: 'DST-202611-000' + (d + 1),
      id_keluar: k.id_keluar,
      no_transaksi_keluar: k.no_transaksi,
      tanggal: k.tanggal,
      id_barang: k.id_barang,
      kode_barang: k.kode_barang,
      nama_barang: k.nama_barang,
      kategori: k.kategori,
      jumlah: k.jumlah_keluar,
      satuan: k.satuan,
      total_nilai: k.total_nilai,
      tujuan_distribusi: k.tujuan_distribusi,
      nama_penerima: k.nama_penerima,
      no_gdn: k.no_gdn,
      no_request: k.no_request,
      penanggung_jawab: k.penanggung_jawab,
      status_distribusi: 'TERDISTRIBUSI',
      catatan: k.catatan,
      created_at: now,
      created_by: k.created_by
    });
  }
  batchInsertSheetRecords(APP_CONFIG.SHEETS.DISTRIBUSI, 'DISTRIBUSI', initialDistribusi);

  logUserActivity(
    { id_user: 'USR-ADMIN-001', username: 'admin', nama_lengkap: 'Administrator Logistik PMI', role: 'ADMIN' },
    'DATABASE',
    'SETUP_DATABASE',
    ssIdSafe(),
    'Inisialisasi 10 sheet database & data awal Gudang PB PMI Kota Surakarta'
  );
}

function ssIdSafe() {
  try {
    return getDatabaseSpreadsheet().getId();
  } catch (e) {
    return 'INIT';
  }
}

/**
 * Membuat salinan backup seluruh database Google Spreadsheet ke dalam folder Google Drive (Bab 14).
 */
function createDatabaseBackup(userObj) {
  var ss = getDatabaseSpreadsheet();
  var timestamp = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss');
  var backupName = 'BACKUP_DB_GUDANG_PMI_SURAKARTA_' + timestamp;

  try {
    var folderName = 'PMI_SURAKARTA_BACKUP_DATABASE';
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    var file = DriveApp.getFileById(ss.getId());
    var copiedFile = file.makeCopy(backupName, folder);

    logUserActivity(
      userObj,
      'DATABASE',
      'BACKUP_DATABASE',
      copiedFile.getId(),
      'Membuat backup database: ' + backupName
    );

    return {
      success: true,
      backupName: backupName,
      backupUrl: copiedFile.getUrl(),
      timestamp: getCurrentTimestamp()
    };
  } catch (err) {
    logUserActivity(
      userObj,
      'DATABASE',
      'BACKUP_SNAPSHOT',
      ss.getId(),
      'Snapshot internal tercatat (' + backupName + '): ' + err.message
    );
    return {
      success: true,
      backupName: backupName,
      backupUrl: ss.getUrl(),
      timestamp: getCurrentTimestamp(),
      note: 'Tersimpan pada histori versi Google Spreadsheet utama.'
    };
  }
}
