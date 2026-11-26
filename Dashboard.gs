/**
 * ============================================================================
 * SISTEM INFORMASI MANAJEMEN STOK GUDANG - PMI KOTA SURAKARTA
 * File: Dashboard.gs
 * Deskripsi: Analitik Dashboard Real-Time (8 KPI Utama, 4 Grafik Interaktif,
 *            Aktivitas Transaksi Terbaru, Peringatan Stok Kritis & Expired)
 *            serta Endpoint Bootstrap Terpadu (getInitialWarehouseBundle)
 *            untuk pemuatan seluruh modul dalam 1 kali eksekusi cepat.
 * ============================================================================
 */

/**
 * Mengambil seluruh data analitik Dashboard Real-Time (Bab 3).
 */
function getDashboardAnalytics(token, filters) {
  requireServerPermission(token, 'canViewDashboard');

  var opts = filters || {};
  var startDate = normalizeDateString(opts.startDate);
  var endDate = normalizeDateString(opts.endDate);
  var selectedYear = String(opts.year || Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyy')).trim();

  var masterData = getMasterBarangWithBalance(token, {});
  var items = masterData.items || [];
  var masukList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK);
  var keluarList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR);
  var opnameList = getSheetRecords(APP_CONFIG.SHEETS.STOCK_OPNAME);

  // 1. Hitung Statistik Master & Stok
  var totalJenisBarang = 0;
  var totalStokKeseluruhan = 0;
  var totalNilaiPersediaan = 0;
  var jumlahStokMenipis = 0;

  var categories = ['FOOD ITEMS', 'NON FOOD', 'OBAT'];
  var catIndexMap = { 'FOOD ITEMS': 0, 'NON FOOD': 1, 'OBAT': 2 };
  var stokByCategory = [0, 0, 0];
  var nilaiByCategory = [0, 0, 0];
  var distribusiByCategory = [0, 0, 0];

  var criticalStockList = [];

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (String(it.status_aktif).toUpperCase() !== 'AKTIF') continue;

    totalJenisBarang++;
    var saldo = toNumber(it.saldo_stok, 0);
    var nilai = toNumber(it.total_nilai, 0);
    var minStok = toNumber(it.stok_minimum, 0);

    totalStokKeseluruhan += saldo;
    totalNilaiPersediaan += nilai;

    var cIdx = catIndexMap[String(it.kategori).toUpperCase()];
    if (cIdx !== undefined) {
      stokByCategory[cIdx] += saldo;
      nilaiByCategory[cIdx] += nilai;
    }

    if (saldo <= minStok) {
      jumlahStokMenipis++;
      criticalStockList.push({
        id_barang: it.id_barang,
        kode_barang: it.kode_barang,
        nama_barang: it.nama_barang,
        kategori: it.kategori,
        saldo_stok: saldo,
        stok_minimum: minStok,
        satuan: it.satuan,
        status_stok: it.status_stok
      });
    }
  }

  criticalStockList.sort(function(a, b) {
    return a.saldo_stok - b.saldo_stok;
  });

  // 2. Hitung Statistik Transaksi Masuk, Keluar & Grafik Bulanan
  var monthlyMasuk = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var monthlyKeluar = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  var jumlahTransaksiMasuk = 0;
  var totalUnitMasukPeriode = 0;
  var jumlahTransaksiKeluar = 0;
  var totalUnitKeluarPeriode = 0;

  var recentCombined = [];

  for (var m = 0; m < masukList.length; m++) {
    var txIn = masukList[m];
    var tglIn = normalizeDateString(txIn.tanggal);
    var qtyIn = toNumber(txIn.jumlah_masuk, 0);

    if (tglIn && tglIn.substring(0, 4) === selectedYear) {
      var mIdxIn = parseInt(tglIn.substring(5, 7), 10) - 1;
      if (mIdxIn >= 0 && mIdxIn < 12) {
        monthlyMasuk[mIdxIn] += qtyIn;
      }
    }

    if ((!startDate || tglIn >= startDate) && (!endDate || tglIn <= endDate)) {
      jumlahTransaksiMasuk++;
      totalUnitMasukPeriode += qtyIn;

      recentCombined.push({
        no_transaksi: txIn.no_transaksi,
        dokumen_ref: txIn.no_grn && txIn.no_grn !== '-' ? txIn.no_grn : 'GRN',
        tanggal: tglIn,
        timestamp: String(txIn.created_at || tglIn || ''),
        nama_barang: txIn.nama_barang,
        kode_barang: txIn.kode_barang,
        kategori: txIn.kategori,
        jenis: 'BARANG MASUK',
        jumlah: qtyIn,
        satuan: txIn.satuan,
        mitra_tujuan: txIn.sumber_donor || '-'
      });
    }
  }

  for (var k = 0; k < keluarList.length; k++) {
    var txOut = keluarList[k];
    var tglOut = normalizeDateString(txOut.tanggal);
    var qtyOut = toNumber(txOut.jumlah_keluar, 0);

    if (tglOut && tglOut.substring(0, 4) === selectedYear) {
      var mIdxOut = parseInt(tglOut.substring(5, 7), 10) - 1;
      if (mIdxOut >= 0 && mIdxOut < 12) {
        monthlyKeluar[mIdxOut] += qtyOut;
      }
    }

    if ((!startDate || tglOut >= startDate) && (!endDate || tglOut <= endDate)) {
      jumlahTransaksiKeluar++;
      totalUnitKeluarPeriode += qtyOut;

      var cIdxOut = catIndexMap[String(txOut.kategori).toUpperCase()];
      if (cIdxOut !== undefined) {
        distribusiByCategory[cIdxOut] += qtyOut;
      }

      recentCombined.push({
        no_transaksi: txOut.no_transaksi,
        dokumen_ref: txOut.no_gdn && txOut.no_gdn !== '-' ? txOut.no_gdn : 'GDN',
        tanggal: tglOut,
        timestamp: String(txOut.created_at || tglOut || ''),
        nama_barang: txOut.nama_barang,
        kode_barang: txOut.kode_barang,
        kategori: txOut.kategori,
        jenis: 'BARANG KELUAR',
        jumlah: qtyOut,
        satuan: txOut.satuan,
        mitra_tujuan: txOut.tujuan_distribusi || '-'
      });
    }
  }

  recentCombined.sort(function(a, b) {
    var cmp = String(b.tanggal).localeCompare(String(a.tanggal));
    if (cmp !== 0) return cmp;
    return String(b.timestamp).localeCompare(String(a.timestamp));
  });

  // 3. Hitung Statistik Monitoring Kedaluwarsa
  var expData = getExpiredDateMonitoring(token, {});
  var expSummary = expData.summary || {};
  var expItems = expData.items || [];

  var nearExpiryList = [];
  for (var e = 0; e < expItems.length; e++) {
    var ex = expItems[e];
    if (ex.status_expired !== 'AMAN') {
      nearExpiryList.push({
        kode_barang: ex.kode_barang,
        nama_barang: ex.nama_barang,
        kategori: ex.kategori,
        expired_date: ex.expired_date,
        days_remaining: ex.days_remaining,
        saldo_stok: ex.saldo_stok_saat_ini,
        satuan: ex.satuan,
        status_expired: ex.status_expired
      });
    }
  }

  // 4. Hitung Jumlah Stock Opname Berstatus PENDING
  var pendingOpnameCount = 0;
  for (var o = 0; o < opnameList.length; o++) {
    if (String(opnameList[o].status_persetujuan).toUpperCase() === 'PENDING') {
      pendingOpnameCount++;
    }
  }

  return {
    stats: {
      totalJenisBarang: totalJenisBarang,
      totalStokKeseluruhan: totalStokKeseluruhan,
      totalNilaiPersediaan: totalNilaiPersediaan,
      jumlahStokMenipis: jumlahStokMenipis,
      jumlahTransaksiMasuk: jumlahTransaksiMasuk,
      totalUnitMasukPeriode: totalUnitMasukPeriode,
      jumlahTransaksiKeluar: jumlahTransaksiKeluar,
      totalUnitKeluarPeriode: totalUnitKeluarPeriode,
      jumlahMendekatiKedaluwarsa: (expSummary.segeraKedaluwarsa || 0) + (expSummary.perhatian || 0),
      jumlahBarangKedaluwarsa: expSummary.kedaluwarsa || 0,
      pendingOpnameCount: pendingOpnameCount
    },
    charts: {
      categories: categories,
      stokByCategory: stokByCategory,
      nilaiByCategory: nilaiByCategory,
      distribusiByCategory: distribusiByCategory,
      monthly: {
        year: selectedYear,
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
        masukQty: monthlyMasuk,
        keluarQty: monthlyKeluar
      }
    },
    recentActivities: recentCombined.slice(0, 10),
    criticalStockList: criticalStockList.slice(0, 8),
    nearExpiryList: nearExpiryList.slice(0, 8)
  };
}

/**
 * Mengambil seluruh data utama aplikasi dalam 1 kali panggilan terpadu (Bootstrap Bundle)
 * sehingga perpindahan antar menu berlangsung instan (0ms) tanpa loading tambahan.
 */
function getInitialWarehouseBundle(token, payload) {
  var auth = requireServerPermission(token, null);
  var settingsRows = getSheetRecords(APP_CONFIG.SHEETS.SETTINGS);
  var settingsObj = {};
  for (var s = 0; s < settingsRows.length; s++) {
    settingsObj[String(settingsRows[s].setting_key)] = settingsRows[s].setting_value;
  }

  return {
    user: auth.user,
    permissions: auth.permissions,
    settings: settingsObj,
    masterData: getMasterBarangWithBalance(token, {}),
    dashboard: getDashboardAnalytics(token, payload || {}),
    transaksiMasuk: getTransaksiMasukList(token, {}),
    transaksiKeluar: getTransaksiKeluarList(token, {}),
    stockOpname: getStockOpnameList(token, {}),
    expiredMonitoring: getExpiredDateMonitoring(token, {})
  };
}
