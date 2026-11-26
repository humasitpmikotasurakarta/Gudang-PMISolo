/**
 * ============================================================================
 * SISTEM INFORMASI MANAJEMEN STOK GUDANG - PMI KOTA SURAKARTA
 * File: Code.gs
 * Deskripsi: Entry point utama Google Apps Script Web App (doGet), fungsi
 *            include template HTML modular, menu kustom pada Google Spreadsheet,
 *            dan router API terpusat (processApiRequest).
 * ============================================================================
 */

/**
 * Menangani HTTP GET saat aplikasi dibuka melalui URL Web App
 * atau ketika dipanggil sebagai endpoint status/API dari Vercel (?ping=1 atau ?action=...).
 */
function doGet(e) {
  // Pastikan database 10 sheet sudah siap ketika aplikasi pertama kali diakses
  try {
    var ss = getDatabaseSpreadsheet();
    if (!ss.getSheetByName(APP_CONFIG.SHEETS.USERS)) {
      setupDatabase();
    }
  } catch (initErr) {}

  // Jika dipanggil dari Vercel untuk pengecekan koneksi (?ping=1) atau GET API (?action=...)
  if (e && e.parameter) {
    if (e.parameter.ping === '1') {
      return createJsonOutput_({
        success: true,
        status: 'ONLINE',
        app: APP_CONFIG.APP_NAME,
        instansi: APP_CONFIG.INSTANSI,
        version: APP_CONFIG.VERSION,
        timestamp: getCurrentTimestamp()
      });
    }
    if (e.parameter.action) {
      var parsedPayload = {};
      if (e.parameter.payload) {
        try {
          parsedPayload = JSON.parse(e.parameter.payload);
        } catch (pErr) {}
      } else {
        parsedPayload = e.parameter;
      }
      var getResult = processApiRequest({
        action: e.parameter.action,
        token: e.parameter.token || '',
        payload: parsedPayload
      });
      return createJsonOutput_(getResult);
    }
  }

  var template = HtmlService.createTemplateFromFile('Index');
  return template
    .evaluate()
    .setTitle(APP_CONFIG.APP_NAME + ' - ' + APP_CONFIG.INSTANSI)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=5.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Menangani HTTP POST dari Frontend yang di-deploy di Vercel (REST JSON API).
 * Menggunakan ContentService (MimeType.JSON) sehingga mendukung panggilan fetch()
 * lintas domain (CORS) dari Vercel baik secara langsung (text/plain;charset=utf-8)
 * maupun melalui Vercel Serverless Proxy (/api/gas).
 */
function doPost(e) {
  try {
    var rawBody = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
    if (!rawBody && e && e.parameter && e.parameter.action) {
      var paramRes = processApiRequest({
        action: e.parameter.action,
        token: e.parameter.token || '',
        payload: e.parameter.payload ? JSON.parse(e.parameter.payload) : {}
      });
      return createJsonOutput_(paramRes);
    }

    var requestObj = JSON.parse(rawBody || '{}');
    var result = processApiRequest(requestObj);
    return createJsonOutput_(result);
  } catch (err) {
    return createJsonOutput_({
      success: false,
      code: 'BAD_REQUEST',
      message: 'Gagal memproses request API dari Vercel: ' + (err.message || String(err))
    });
  }
}

/**
 * Helper pembuat respons JSON ContentService untuk konektivitas Vercel <-> GAS.
 */
function createJsonOutput_(dataObj) {
  return ContentService
    .createTextOutput(JSON.stringify(dataObj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Helper untuk menyertakan file HTML modular (CSS.html, Components.html, JavaScript.html)
 * ke dalam Index.html.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Menambahkan menu kustom "Gudang PMI Surakarta" pada toolbar Google Spreadsheet
 * jika script dipasang sebagai Container-Bound Script.
 */
function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('🏢 Gudang PMI Surakarta')
      .addItem('1. Jalankan Setup Database Otomatis (10 Sheet)', 'menuSetupDatabase')
      .addItem('2. Hitung Ulang Seluruh Saldo Stok (Recalculate)', 'menuRecalculateBalances')
      .addSeparator()
      .addItem('3. Buat Backup Database ke Google Drive', 'menuCreateBackup')
      .addToUi();
  } catch (e) {}
}

function menuSetupDatabase() {
  var res = setupDatabase();
  try {
    SpreadsheetApp.getUi().alert('Setup Database Berhasil', res.message + '\nID: ' + res.spreadsheetId, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}
}

function menuRecalculateBalances() {
  recalculateAllStockBalances();
  try {
    SpreadsheetApp.getUi().alert('Rekalkulasi Selesai', 'Seluruh saldo stok dan nilai persediaan di sheet STOCK_BALANCE telah diperbarui.', SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}
}

function menuCreateBackup() {
  var res = createDatabaseBackup({ id_user: 'ADMIN-SHEET', username: 'admin', nama_lengkap: 'Admin Spreadsheet', role: 'ADMIN' });
  try {
    SpreadsheetApp.getUi().alert('Backup Selesai', 'File Backup: ' + res.backupName, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}
}

/**
 * Router API Terpusat untuk seluruh panggilan dari frontend (google.script.run.processApiRequest).
 * Seluruh operasi divalidasi hak aksesnya di sisi server dan dibungkus penanganan error terstandar.
 */
function processApiRequest(requestObj) {
  try {
    if (!requestObj || !requestObj.action) {
      throw new Error('Permintaan tidak valid: parameter action kosong.');
    }

    var action = String(requestObj.action).toUpperCase().trim();
    var token = requestObj.token || '';
    var payload = requestObj.payload || {};

    switch (action) {
      // 1. AUTENTIKASI & SESI
      case 'LOGIN':
        var authData = authenticateUser(payload.username, payload.password);
        return {
          success: true,
          message: 'Selamat datang, ' + authData.user.nama_lengkap + ' (' + authData.user.role + ')',
          data: authData
        };

      case 'LOGOUT':
        logoutUserSession(token);
        return {
          success: true,
          message: 'Anda telah keluar dari sistem.'
        };

      case 'VERIFY_SESSION':
        var sessionCheck = requireServerPermission(token, null);
        var settingsRows = getSheetRecords(APP_CONFIG.SHEETS.SETTINGS);
        var settingsObj = {};
        for (var s = 0; s < settingsRows.length; s++) {
          settingsObj[String(settingsRows[s].setting_key)] = settingsRows[s].setting_value;
        }
        return {
          success: true,
          data: {
            user: sessionCheck.user,
            permissions: sessionCheck.permissions,
            settings: settingsObj
          }
        };

      // 2. SETUP & BACKUP DATABASE
      case 'SETUP_DATABASE':
        var setupRes = setupDatabase();
        return {
          success: true,
          message: setupRes.message,
          data: setupRes
        };

      case 'BACKUP_DATABASE':
        var backupAuth = requireServerPermission(token, 'canManageSettings');
        var backupRes = createDatabaseBackup(backupAuth.user);
        return {
          success: true,
          message: 'Backup database berhasil dibuat: ' + backupRes.backupName,
          data: backupRes
        };

      // 3. DASHBOARD REAL-TIME & INITIAL BUNDLE
      case 'GET_INITIAL_BUNDLE':
        var bundleData = getInitialWarehouseBundle(token, payload);
        return {
          success: true,
          data: bundleData
        };

      case 'GET_DASHBOARD':
        var dashData = getDashboardAnalytics(token, payload);
        return {
          success: true,
          data: dashData
        };

      // 4. MASTER DATA BARANG & DONOR
      case 'GET_MASTER_BARANG':
        var masterRes = getMasterBarangWithBalance(token, payload);
        return {
          success: true,
          data: masterRes
        };

      case 'SAVE_MASTER_BARANG':
        var saveMasterRes = saveMasterBarang(token, payload);
        return {
          success: true,
          message: saveMasterRes.message,
          data: saveMasterRes
        };

      case 'DELETE_MASTER_BARANG':
        var delMasterRes = deleteMasterBarang(token, payload.id_barang);
        return {
          success: true,
          message: delMasterRes.message
        };

      case 'SAVE_DONOR':
        var saveDonorRes = saveDonorRecord(token, payload);
        return {
          success: true,
          message: saveDonorRes.message,
          data: saveDonorRes
        };

      case 'IMPORT_EXCEL_DATA':
        var importRes = importExcelBatchData(token, payload);
        return {
          success: true,
          message: importRes.message,
          data: importRes.stats
        };

      // 5. TRANSAKSI BARANG MASUK (GRN)
      case 'GET_TRANSAKSI_MASUK':
        var listIn = getTransaksiMasukList(token, payload);
        return {
          success: true,
          data: listIn
        };

      case 'SAVE_TRANSAKSI_MASUK':
        var saveInRes = saveTransaksiMasuk(token, payload);
        return {
          success: true,
          message: saveInRes.message,
          data: saveInRes.transaction
        };

      case 'DELETE_TRANSAKSI_MASUK':
        var delInRes = deleteTransaksiMasuk(token, payload.id_masuk, payload.alasan);
        return {
          success: true,
          message: delInRes.message
        };

      // 6. TRANSAKSI BARANG KELUAR (GDN) & DISTRIBUSI
      case 'GET_TRANSAKSI_KELUAR':
        var listOut = getTransaksiKeluarList(token, payload);
        return {
          success: true,
          data: listOut
        };

      case 'SAVE_TRANSAKSI_KELUAR':
        var saveOutRes = saveTransaksiKeluar(token, payload);
        return {
          success: true,
          message: saveOutRes.message,
          data: saveOutRes.transaction
        };

      case 'DELETE_TRANSAKSI_KELUAR':
        var delOutRes = deleteTransaksiKeluar(token, payload.id_keluar, payload.alasan);
        return {
          success: true,
          message: delOutRes.message
        };

      // 7. KARTU STOK / STOCK CARD
      case 'GET_KARTU_STOK':
        var stockCardData = getKartuStokBarang(token, payload);
        return {
          success: true,
          data: stockCardData
        };

      // 8. STOCK OPNAME
      case 'GET_STOCK_OPNAME':
        var opnameData = getStockOpnameList(token, payload);
        return {
          success: true,
          data: opnameData
        };

      case 'SAVE_STOCK_OPNAME':
        var saveOpnameRes = saveStockOpnameBatch(token, payload);
        return {
          success: true,
          message: saveOpnameRes.message,
          data: saveOpnameRes.records
        };

      case 'APPROVE_STOCK_OPNAME':
        var approveRes = approveOrRejectStockOpname(token, payload);
        return {
          success: true,
          message: approveRes.message
        };

      // 9. MONITORING EXPIRED DATE
      case 'GET_EXPIRED_MONITORING':
        var expData = getExpiredDateMonitoring(token, payload);
        return {
          success: true,
          data: expData
        };

      // 10. LAPORAN (12 JENIS LAPORAN)
      case 'GENERATE_REPORT':
        var repData = generateWarehouseReport(token, payload);
        return {
          success: true,
          data: repData
        };

      // 11. MANAJEMEN PENGGUNA, LOG AKTIVITAS & SETTINGS
      case 'GET_USERS':
        var usersData = getAllUsersForAdmin(token);
        return {
          success: true,
          data: usersData
        };

      case 'SAVE_USER':
        var saveUserRes = saveUserAccount(token, payload);
        return {
          success: true,
          message: saveUserRes.message,
          data: saveUserRes.user
        };

      case 'GET_LOGS_AND_SETTINGS':
        requireServerPermission(token, 'canViewLogs');
        var logs = getSheetRecords(APP_CONFIG.SHEETS.LOG_AKTIVITAS);
        logs.sort(function(a, b) {
          return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
        });
        var settings = getSheetRecords(APP_CONFIG.SHEETS.SETTINGS);
        return {
          success: true,
          data: {
            logs: logs.slice(0, 200),
            settings: settings
          }
        };

      case 'SAVE_SETTINGS':
        var saveSetRes = saveApplicationSettings(token, payload);
        return {
          success: true,
          message: saveSetRes.message
        };

      default:
        throw new Error('Action API tidak dikenali: ' + action);
    }
  } catch (err) {
    return {
      success: false,
      code: err.code || 'ERROR',
      message: err.message || String(err)
    };
  }
}
