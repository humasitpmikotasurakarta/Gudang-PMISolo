/**
 * ============================================================================
 * SISTEM INFORMASI MANAJEMEN STOK GUDANG - PMI KOTA SURAKARTA
 * File: Laporan.gs
 * Deskripsi: Modul Monitoring Expired Date (Bab 9) dan Pusat Generator 12
 *            Jenis Laporan Resmi Gudang PMI Kota Surakarta (Bab 10) lengkap
 *            dengan filter tanggal, kategori, nama barang, dan sumber/donor.
 * ============================================================================
 */

/**
 * MONITORING EXPIRED DATE (Bab 9).
 * Hanya diterapkan pada barang/batch yang memiliki tanggal kedaluwarsa.
 * Status otomatis:
 * - AMAN: > 90 hari
 * - PERHATIAN: 31 - 90 hari
 * - SEGERA KEDALUWARSA: 1 - 30 hari
 * - KEDALUWARSA: melewati atau tepat tanggal expired (<= 0 hari)
 */
function getExpiredDateMonitoring(token, filters) {
  requireServerPermission(token, 'canViewExpired');

  var masterData = getMasterBarangWithBalance(token, {});
  var itemsMap = {};
  for (var i = 0; i < masterData.items.length; i++) {
    itemsMap[String(masterData.items[i].id_barang)] = masterData.items[i];
  }

  var masukList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK);
  var expiredRecords = [];
  var seenBatchKey = {};

  // Kumpulkan batch barang masuk yang memiliki tanggal kedaluwarsa
  for (var m = 0; m < masukList.length; m++) {
    var txIn = masukList[m];
    var expStr = normalizeDateString(txIn.expired_date);
    if (!expStr) continue;

    var masterItem = itemsMap[String(txIn.id_barang)];
    if (!masterItem || String(masterItem.status_aktif).toUpperCase() !== 'AKTIF') continue;

    var evalResult = evaluateExpiryStatus(expStr);
    if (!evalResult.hasExpiry) continue;

    var batchKey = String(txIn.id_barang) + '::' + expStr + '::' + String(txIn.no_grn || txIn.no_transaksi);
    if (seenBatchKey[batchKey]) continue;
    seenBatchKey[batchKey] = true;

    expiredRecords.push({
      id_masuk: txIn.id_masuk,
      id_barang: masterItem.id_barang,
      kode_barang: masterItem.kode_barang,
      nama_barang: masterItem.nama_barang,
      kategori: masterItem.kategori,
      satuan: masterItem.satuan,
      harga_unit: toNumber(masterItem.harga_unit, 0),
      sumber_donor: txIn.sumber_donor || masterItem.sumber_donor || '-',
      no_batch_dokumen: txIn.no_grn && txIn.no_grn !== '-' ? txIn.no_grn : txIn.no_transaksi,
      tanggal_masuk: normalizeDateString(txIn.tanggal),
      jumlah_batch_masuk: toNumber(txIn.jumlah_masuk, 0),
      saldo_stok_saat_ini: toNumber(masterItem.saldo_stok, 0),
      total_nilai_stok: toNumber(masterItem.total_nilai, 0),
      lokasi_rak: masterItem.lokasi_rak || '-',
      expired_date: evalResult.expiredDate,
      days_remaining: evalResult.daysRemaining,
      status_expired: evalResult.status,
      badge_class: evalResult.badgeClass,
      catatan: txIn.catatan || ''
    });
  }

  // Urutkan dari tanggal kedaluwarsa paling dekat / sudah lewat
  expiredRecords.sort(function(a, b) {
    return a.days_remaining - b.days_remaining;
  });

  var summaryCounts = {
    totalItemBerexpired: expiredRecords.length,
    kedaluwarsa: 0,
    segeraKedaluwarsa: 0,
    perhatian: 0,
    aman: 0
  };

  for (var c = 0; c < expiredRecords.length; c++) {
    var st = expiredRecords[c].status_expired;
    if (st === 'KEDALUWARSA') summaryCounts.kedaluwarsa++;
    else if (st === 'SEGERA KEDALUWARSA') summaryCounts.segeraKedaluwarsa++;
    else if (st === 'PERHATIAN') summaryCounts.perhatian++;
    else if (st === 'AMAN') summaryCounts.aman++;
  }

  // Terapkan filter pencarian, kategori, status, dan rentang tanggal kedaluwarsa
  if (filters) {
    var kat = String(filters.kategori || '').toUpperCase().trim();
    var statusFilter = String(filters.status_expired || '').toUpperCase().trim();
    var startExp = normalizeDateString(filters.startDate);
    var endExp = normalizeDateString(filters.endDate);
    var q = String(filters.search || '').toLowerCase().trim();

    expiredRecords = expiredRecords.filter(function(r) {
      if (kat && kat !== 'SEMUA' && String(r.kategori).toUpperCase() !== kat) return false;
      if (statusFilter && statusFilter !== 'SEMUA' && String(r.status_expired).toUpperCase() !== statusFilter) return false;
      if (startExp && r.expired_date < startExp) return false;
      if (endExp && r.expired_date > endExp) return false;
      if (q) {
        var hay = (r.kode_barang + ' ' + r.nama_barang + ' ' + r.no_batch_dokumen + ' ' + r.sumber_donor).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  return {
    summary: summaryCounts,
    items: expiredRecords
  };
}

/**
 * GENERATOR 12 JENIS LAPORAN RESMI PMI KOTA SURAKARTA (Bab 10):
 *  1. STOK_KESELURUHAN     : Laporan stok keseluruhan
 *  2. STOK_FOOD            : Laporan stok Food Items
 *  3. STOK_NON_FOOD        : Laporan stok Non Food
 *  4. STOK_OBAT            : Laporan stok Obat
 *  5. BARANG_MASUK         : Laporan barang masuk
 *  6. BARANG_KELUAR        : Laporan barang keluar
 *  7. DISTRIBUSI_BANTUAN   : Laporan distribusi bantuan
 *  8. NILAI_PERSEDIAAN     : Laporan nilai persediaan
 *  9. STOK_MINIMUM         : Laporan stok minimum
 * 10. BARANG_KEDALUWARSA   : Laporan barang kedaluwarsa
 * 11. STOCK_OPNAME         : Laporan stock opname
 * 12. SUMBER_DONOR         : Laporan sumber barang/donor
 */
function generateWarehouseReport(token, payload) {
  requireServerPermission(token, 'canViewLaporan');

  var reportType = String(payload.reportType || 'STOK_KESELURUHAN').toUpperCase().trim();
  var startDate = normalizeDateString(payload.startDate);
  var endDate = normalizeDateString(payload.endDate);
  var filterKategori = String(payload.kategori || 'SEMUA').toUpperCase().trim();
  var filterBarang = String(payload.namaBarang || '').toLowerCase().trim();
  var filterSumber = String(payload.sumberDonor || '').toLowerCase().trim();

  var settingsList = getSheetRecords(APP_CONFIG.SHEETS.SETTINGS);
  var settingsMap = {};
  for (var s = 0; s < settingsList.length; s++) {
    settingsMap[String(settingsList[s].setting_key)] = settingsList[s].setting_value;
  }

  var masterData = getMasterBarangWithBalance(token, {});
  var allItems = masterData.items || [];

  var reportTitle = '';
  var columns = [];
  var rows = [];
  var summary = {};

  // Helper filter item master
  function matchMasterFilter(it, forcedCategory) {
    var targetCat = forcedCategory || filterKategori;
    if (targetCat && targetCat !== 'SEMUA' && String(it.kategori).toUpperCase() !== targetCat) {
      return false;
    }
    if (filterBarang) {
      var hayB = (String(it.kode_barang) + ' ' + String(it.nama_barang)).toLowerCase();
      if (hayB.indexOf(filterBarang) === -1) return false;
    }
    if (filterSumber && filterSumber !== 'semua') {
      if (String(it.sumber_donor || '').toLowerCase().indexOf(filterSumber) === -1) return false;
    }
    return true;
  }

  // 1 - 4: LAPORAN STOK (KESELURUHAN, FOOD ITEMS, NON FOOD, OBAT)
  if (
    reportType === 'STOK_KESELURUHAN' ||
    reportType === 'STOK_FOOD' ||
    reportType === 'STOK_NON_FOOD' ||
    reportType === 'STOK_OBAT'
  ) {
    var forcedCat = null;
    if (reportType === 'STOK_FOOD') {
      forcedCat = 'FOOD ITEMS';
      reportTitle = 'LAPORAN PERSEDIAAN STOK KATEGORI FOOD ITEMS (PANGAN)';
    } else if (reportType === 'STOK_NON_FOOD') {
      forcedCat = 'NON FOOD';
      reportTitle = 'LAPORAN PERSEDIAAN STOK KATEGORI NON FOOD (LOGISTIK & SHELTER)';
    } else if (reportType === 'STOK_OBAT') {
      forcedCat = 'OBAT';
      reportTitle = 'LAPORAN PERSEDIAAN STOK KATEGORI OBAT & FARMASI';
    } else {
      reportTitle = 'LAPORAN STOK KESELURUHAN GUDANG PMI KOTA SURAKARTA';
    }

    columns = [
      'No',
      'Kode Barang',
      'Nama Barang',
      'Kategori',
      'Satuan',
      'Harga Satuan (Rp)',
      'Sumber',
      'Total Masuk',
      'Total Keluar',
      'Penyesuaian',
      'Saldo Stok',
      'Total Nilai (Rp)',
      'Expired Terdekat',
      'Lokasi Rak',
      'Status Stok'
    ];

    var totJenis = 0;
    var totSaldo = 0;
    var totNilai = 0;

    for (var i = 0; i < allItems.length; i++) {
      var it = allItems[i];
      if (!matchMasterFilter(it, forcedCat)) continue;
      totJenis++;
      totSaldo += toNumber(it.saldo_stok, 0);
      totNilai += toNumber(it.total_nilai, 0);

      rows.push([
        totJenis,
        it.kode_barang,
        it.nama_barang,
        it.kategori,
        it.satuan,
        toNumber(it.harga_unit, 0),
        it.sumber_donor,
        toNumber(it.total_masuk, 0),
        toNumber(it.total_keluar, 0),
        toNumber(it.penyesuaian_opname, 0),
        toNumber(it.saldo_stok, 0),
        toNumber(it.total_nilai, 0),
        it.nearest_expired_date || '-',
        it.lokasi_rak,
        it.status_stok
      ]);
    }

    summary = {
      'Total Jenis Barang': totJenis + ' Jenis',
      'Total Saldo Unit': totSaldo.toLocaleString('id-ID') + ' Unit',
      'Total Nilai Persediaan': 'Rp ' + totNilai.toLocaleString('id-ID')
    };
  }

  // 5. LAPORAN BARANG MASUK
  else if (reportType === 'BARANG_MASUK') {
    reportTitle = 'LAPORAN TRANSAKSI PENERIMAAN BARANG MASUK (GRN)';
    columns = [
      'No',
      'No. Transaksi',
      'Tanggal',
      'No. Dokumen GRN',
      'No. Request',
      'Kode Barang',
      'Nama Barang',
      'Kategori',
      'Jumlah Masuk',
      'Satuan',
      'Harga Unit (Rp)',
      'Total Nilai (Rp)',
      'Sumber',
      'Expired Date',
      'Catatan'
    ];

    var inList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK);
    var countIn = 0;
    var sumQtyIn = 0;
    var sumValIn = 0;

    for (var m = 0; m < inList.length; m++) {
      var rIn = inList[m];
      var tglIn = normalizeDateString(rIn.tanggal);
      if (startDate && tglIn < startDate) continue;
      if (endDate && tglIn > endDate) continue;
      if (filterKategori && filterKategori !== 'SEMUA' && String(rIn.kategori).toUpperCase() !== filterKategori) continue;
      if (filterBarang && (String(rIn.kode_barang) + ' ' + String(rIn.nama_barang)).toLowerCase().indexOf(filterBarang) === -1) continue;
      if (filterSumber && filterSumber !== 'semua' && String(rIn.sumber_donor).toLowerCase().indexOf(filterSumber) === -1) continue;

      countIn++;
      var qIn = toNumber(rIn.jumlah_masuk, 0);
      var vIn = toNumber(rIn.total_nilai, 0);
      sumQtyIn += qIn;
      sumValIn += vIn;

      rows.push([
        countIn,
        rIn.no_transaksi,
        tglIn,
        rIn.no_grn || '-',
        rIn.no_request || '-',
        rIn.kode_barang,
        rIn.nama_barang,
        rIn.kategori,
        qIn,
        rIn.satuan,
        toNumber(rIn.harga_unit, 0),
        vIn,
        rIn.sumber_donor || '-',
        normalizeDateString(rIn.expired_date) || '-',
        rIn.catatan || '-'
      ]);
    }

    summary = {
      'Jumlah Transaksi Masuk': countIn + ' Transaksi',
      'Total Unit Diterima': sumQtyIn.toLocaleString('id-ID') + ' Unit',
      'Total Nilai Penerimaan': 'Rp ' + sumValIn.toLocaleString('id-ID')
    };
  }

  // 6. LAPORAN BARANG KELUAR
  else if (reportType === 'BARANG_KELUAR') {
    reportTitle = 'LAPORAN TRANSAKSI PENGELUARAN BARANG KELUAR (GDN)';
    columns = [
      'No',
      'No. Transaksi',
      'Tanggal',
      'No. Dokumen GDN',
      'No. Request',
      'Kode Barang',
      'Nama Barang',
      'Kategori',
      'Jumlah Keluar',
      'Satuan',
      'Harga Unit (Rp)',
      'Total Nilai (Rp)',
      'Tujuan Distribusi',
      'Nama Penerima',
      'Penanggung Jawab'
    ];

    var outList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR);
    var countOut = 0;
    var sumQtyOut = 0;
    var sumValOut = 0;

    for (var k = 0; k < outList.length; k++) {
      var rOut = outList[k];
      var tglOut = normalizeDateString(rOut.tanggal);
      if (startDate && tglOut < startDate) continue;
      if (endDate && tglOut > endDate) continue;
      if (filterKategori && filterKategori !== 'SEMUA' && String(rOut.kategori).toUpperCase() !== filterKategori) continue;
      if (filterBarang && (String(rOut.kode_barang) + ' ' + String(rOut.nama_barang)).toLowerCase().indexOf(filterBarang) === -1) continue;
      if (filterSumber && filterSumber !== 'semua' && String(rOut.tujuan_distribusi).toLowerCase().indexOf(filterSumber) === -1) continue;

      countOut++;
      var qOut = toNumber(rOut.jumlah_keluar, 0);
      var vOut = toNumber(rOut.total_nilai, 0);
      sumQtyOut += qOut;
      sumValOut += vOut;

      rows.push([
        countOut,
        rOut.no_transaksi,
        tglOut,
        rOut.no_gdn || '-',
        rOut.no_request || '-',
        rOut.kode_barang,
        rOut.nama_barang,
        rOut.kategori,
        qOut,
        rOut.satuan,
        toNumber(rOut.harga_unit, 0),
        vOut,
        rOut.tujuan_distribusi,
        rOut.nama_penerima,
        rOut.penanggung_jawab
      ]);
    }

    summary = {
      'Jumlah Transaksi Keluar': countOut + ' Transaksi',
      'Total Unit Keluar': sumQtyOut.toLocaleString('id-ID') + ' Unit',
      'Total Nilai Barang Keluar': 'Rp ' + sumValOut.toLocaleString('id-ID')
    };
  }

  // 7. LAPORAN DISTRIBUSI BANTUAN
  else if (reportType === 'DISTRIBUSI_BANTUAN') {
    reportTitle = 'LAPORAN REALISASI DISTRIBUSI BANTUAN LOGISTIK KEMANUSIAAN';
    columns = [
      'No',
      'No. Distribusi',
      'Tanggal',
      'Tujuan Distribusi / Lokasi Bencana',
      'Nama Penerima',
      'No. GDN',
      'No. Request',
      'Kode Barang',
      'Nama Barang',
      'Kategori',
      'Jumlah',
      'Satuan',
      'Nilai Bantuan (Rp)',
      'Penanggung Jawab',
      'Status'
    ];

    var distList = getSheetRecords(APP_CONFIG.SHEETS.DISTRIBUSI);
    var countDist = 0;
    var sumQtyDist = 0;
    var sumValDist = 0;

    for (var d = 0; d < distList.length; d++) {
      var rDist = distList[d];
      var tglD = normalizeDateString(rDist.tanggal);
      if (startDate && tglD < startDate) continue;
      if (endDate && tglD > endDate) continue;
      if (filterKategori && filterKategori !== 'SEMUA' && String(rDist.kategori).toUpperCase() !== filterKategori) continue;
      if (filterBarang && (String(rDist.kode_barang) + ' ' + String(rDist.nama_barang)).toLowerCase().indexOf(filterBarang) === -1) continue;

      countDist++;
      var qD = toNumber(rDist.jumlah, 0);
      var vD = toNumber(rDist.total_nilai, 0);
      sumQtyDist += qD;
      sumValDist += vD;

      rows.push([
        countDist,
        rDist.no_distribusi,
        tglD,
        rDist.tujuan_distribusi,
        rDist.nama_penerima,
        rDist.no_gdn || '-',
        rDist.no_request || '-',
        rDist.kode_barang,
        rDist.nama_barang,
        rDist.kategori,
        qD,
        rDist.satuan,
        vD,
        rDist.penanggung_jawab,
        rDist.status_distribusi || 'TERDISTRIBUSI'
      ]);
    }

    summary = {
      'Total Penyaluran Distribusi': countDist + ' Pengiriman',
      'Total Unit Bantuan': sumQtyDist.toLocaleString('id-ID') + ' Unit',
      'Total Valuasi Bantuan': 'Rp ' + sumValDist.toLocaleString('id-ID')
    };
  }

  // 8. LAPORAN NILAI PERSEDIAAN
  else if (reportType === 'NILAI_PERSEDIAAN') {
    reportTitle = 'LAPORAN VALUASI NILAI PERSEDIAAN ASET LOGISTIK GUDANG';
    columns = [
      'No',
      'Kode Barang',
      'Nama Barang',
      'Kategori',
      'Sumber',
      'Satuan',
      'Saldo Stok',
      'Harga Per Unit (Rp)',
      'Total Nilai Persediaan (Rp)',
      'Persentase Nilai (%)'
    ];

    var filteredValItems = [];
    var grandTotalVal = 0;
    for (var v = 0; v < allItems.length; v++) {
      if (!matchMasterFilter(allItems[v], null)) continue;
      filteredValItems.push(allItems[v]);
      grandTotalVal += toNumber(allItems[v].total_nilai, 0);
    }

    // Urutkan dari nilai tertinggi
    filteredValItems.sort(function(a, b) {
      return toNumber(b.total_nilai, 0) - toNumber(a.total_nilai, 0);
    });

    for (var vi = 0; vi < filteredValItems.length; vi++) {
      var fv = filteredValItems[vi];
      var itemVal = toNumber(fv.total_nilai, 0);
      var pct = grandTotalVal > 0 ? ((itemVal / grandTotalVal) * 100).toFixed(2) + '%' : '0.00%';
      rows.push([
        vi + 1,
        fv.kode_barang,
        fv.nama_barang,
        fv.kategori,
        fv.sumber_donor,
        fv.satuan,
        toNumber(fv.saldo_stok, 0),
        toNumber(fv.harga_unit, 0),
        itemVal,
        pct
      ]);
    }

    summary = {
      'Jumlah Item Dihitung': filteredValItems.length + ' Jenis Barang',
      'Total Nilai Persediaan Gudang': 'Rp ' + grandTotalVal.toLocaleString('id-ID')
    };
  }

  // 9. LAPORAN STOK MINIMUM
  else if (reportType === 'STOK_MINIMUM') {
    reportTitle = 'LAPORAN DAFTAR BARANG STOK MINIMUM / KRITIS (REORDER ALERT)';
    columns = [
      'No',
      'Kode Barang',
      'Nama Barang',
      'Kategori',
      'Satuan',
      'Saldo Stok Saat Ini',
      'Batas Stok Minimum',
      'Kekurangan Stok',
      'Lokasi Rak',
      'Sumber',
      'Status Kritis'
    ];

    var countMin = 0;
    var countHabis = 0;
    for (var sm = 0; sm < allItems.length; sm++) {
      var itMin = allItems[sm];
      if (!matchMasterFilter(itMin, null)) continue;
      var sCur = toNumber(itMin.saldo_stok, 0);
      var sMin = toNumber(itMin.stok_minimum, 0);
      if (sCur <= sMin) {
        countMin++;
        if (sCur <= 0) countHabis++;
        rows.push([
          countMin,
          itMin.kode_barang,
          itMin.nama_barang,
          itMin.kategori,
          itMin.satuan,
          sCur,
          sMin,
          Math.max(0, sMin - sCur),
          itMin.lokasi_rak,
          itMin.sumber_donor,
          itMin.status_stok
        ]);
      }
    }

    summary = {
      'Total Barang Stok Menipis/Kritis': countMin + ' Jenis',
      'Barang Stok Habis (0)': countHabis + ' Jenis'
    };
  }

  // 10. LAPORAN BARANG KEDALUWARSA
  else if (reportType === 'BARANG_KEDALUWARSA') {
    reportTitle = 'LAPORAN MONITORING TANGGAL KEDALUWARSA BARANG (EXPIRED DATE)';
    columns = [
      'No',
      'Kode Barang',
      'Nama Barang',
      'Kategori',
      'No. Dokumen/GRN',
      'Sumber',
      'Saldo Stok',
      'Satuan',
      'Tanggal Kedaluwarsa',
      'Sisa Hari',
      'Status Kedaluwarsa',
      'Lokasi Rak'
    ];

    var expData = getExpiredDateMonitoring(token, {
      kategori: filterKategori,
      startDate: startDate,
      endDate: endDate,
      search: filterBarang
    });

    var expItems = expData.items || [];
    for (var ex = 0; ex < expItems.length; ex++) {
      var eRow = expItems[ex];
      if (filterSumber && filterSumber !== 'semua' && String(eRow.sumber_donor).toLowerCase().indexOf(filterSumber) === -1) {
        continue;
      }
      rows.push([
        rows.length + 1,
        eRow.kode_barang,
        eRow.nama_barang,
        eRow.kategori,
        eRow.no_batch_dokumen,
        eRow.sumber_donor,
        eRow.saldo_stok_saat_ini,
        eRow.satuan,
        eRow.expired_date,
        eRow.days_remaining + ' Hari',
        eRow.status_expired,
        eRow.lokasi_rak
      ]);
    }

    summary = {
      'Sudah Kedaluwarsa (<= 0 Hari)': expData.summary.kedaluwarsa + ' Batch',
      'Segera Kedaluwarsa (1-30 Hari)': expData.summary.segeraKedaluwarsa + ' Batch',
      'Perhatian (31-90 Hari)': expData.summary.perhatian + ' Batch',
      'Aman (> 90 Hari)': expData.summary.aman + ' Batch'
    };
  }

  // 11. LAPORAN STOCK OPNAME
  else if (reportType === 'STOCK_OPNAME') {
    reportTitle = 'LAPORAN PEMERIKSAAN FISIK PERSEDIAAN (STOCK OPNAME)';
    columns = [
      'No',
      'No. Opname',
      'Tgl Periksa',
      'Kode Barang',
      'Nama Barang',
      'Kategori',
      'Satuan',
      'Stok Sistem',
      'Stok Fisik',
      'Selisih',
      'Nilai Selisih (Rp)',
      'Alasan Selisih',
      'Petugas Pemeriksa',
      'Status Persetujuan',
      'Disetujui Oleh'
    ];

    var soList = getSheetRecords(APP_CONFIG.SHEETS.STOCK_OPNAME);
    var countSo = 0;
    var countApproved = 0;

    for (var so = 0; so < soList.length; so++) {
      var rSo = soList[so];
      var tglSo = normalizeDateString(rSo.tanggal_periksa || rSo.tanggal_jadwal);
      if (startDate && tglSo < startDate) continue;
      if (endDate && tglSo > endDate) continue;
      if (filterKategori && filterKategori !== 'SEMUA' && String(rSo.kategori).toUpperCase() !== filterKategori) continue;
      if (filterBarang && (String(rSo.kode_barang) + ' ' + String(rSo.nama_barang)).toLowerCase().indexOf(filterBarang) === -1) continue;

      countSo++;
      if (String(rSo.status_persetujuan).toUpperCase() === 'APPROVED') countApproved++;

      rows.push([
        countSo,
        rSo.no_opname,
        tglSo,
        rSo.kode_barang,
        rSo.nama_barang,
        rSo.kategori,
        rSo.satuan,
        toNumber(rSo.stok_sistem, 0),
        toNumber(rSo.stok_fisik, 0),
        toNumber(rSo.selisih, 0),
        toNumber(rSo.nilai_selisih, 0),
        rSo.alasan_selisih || '-',
        rSo.petugas_pemeriksa,
        rSo.status_persetujuan,
        rSo.disetujui_oleh || '-'
      ]);
    }

    summary = {
      'Total Pemeriksaan Opname': countSo + ' Record',
      'Telah Disetujui (APPROVED)': countApproved + ' Record',
      'Menunggu Persetujuan (PENDING)': (countSo - countApproved) + ' Record'
    };
  }

  // 12. LAPORAN SUMBER BARANG
  else if (reportType === 'SUMBER_DONOR') {
    reportTitle = 'LAPORAN REKAPITULASI PENERIMAAN & PERSEDIAAN BERDASARKAN SUMBER BARANG';
    columns = [
      'No',
      'Sumber Barang',
      'Jumlah Jenis Barang',
      'Total Transaksi Masuk',
      'Total Unit Diterima',
      'Saldo Stok Tersisa',
      'Total Nilai Kontribusi (Rp)'
    ];

    var donorAgg = {};
    var inRecords = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK);

    for (var ir = 0; ir < inRecords.length; ir++) {
      var recIn = inRecords[ir];
      var tglIr = normalizeDateString(recIn.tanggal);
      if (startDate && tglIr < startDate) continue;
      if (endDate && tglIr > endDate) continue;
      if (filterKategori && filterKategori !== 'SEMUA' && String(recIn.kategori).toUpperCase() !== filterKategori) continue;

      var dName = String(recIn.sumber_donor || 'TIDAK TERCATAT').trim().toUpperCase();
      if (filterSumber && filterSumber !== 'semua' && dName.toLowerCase().indexOf(filterSumber) === -1) continue;

      if (!donorAgg[dName]) {
        donorAgg[dName] = {
          donor: dName,
          itemSet: {},
          trxCount: 0,
          unitMasuk: 0,
          saldoTersisa: 0,
          totalNilai: 0
        };
      }
      donorAgg[dName].itemSet[String(recIn.id_barang)] = true;
      donorAgg[dName].trxCount++;
      donorAgg[dName].unitMasuk += toNumber(recIn.jumlah_masuk, 0);
      donorAgg[dName].totalNilai += toNumber(recIn.total_nilai, 0);
    }

    for (var ai = 0; ai < allItems.length; ai++) {
      var mIt = allItems[ai];
      var dKey = String(mIt.sumber_donor || 'TIDAK TERCATAT').trim().toUpperCase();
      if (donorAgg[dKey]) {
        donorAgg[dKey].saldoTersisa += toNumber(mIt.saldo_stok, 0);
      }
    }

    var dKeys = Object.keys(donorAgg);
    var grandDonorVal = 0;
    for (var dk = 0; dk < dKeys.length; dk++) {
      var dObj = donorAgg[dKeys[dk]];
      var itemKinds = Object.keys(dObj.itemSet).length;
      grandDonorVal += dObj.totalNilai;
      rows.push([
        dk + 1,
        dObj.donor,
        itemKinds,
        dObj.trxCount,
        dObj.unitMasuk,
        dObj.saldoTersisa,
        dObj.totalNilai
      ]);
    }

    summary = {
      'Total Mitra Sumber': dKeys.length + ' Sumber',
      'Total Nilai Kontribusi Logistik': 'Rp ' + grandDonorVal.toLocaleString('id-ID')
    };
  }

  var periodeLabel = 'Semua Periode';
  if (startDate && endDate) {
    periodeLabel = startDate + ' s/d ' + endDate;
  } else if (startDate) {
    periodeLabel = 'Sejak ' + startDate;
  } else if (endDate) {
    periodeLabel = 'Sampai ' + endDate;
  }

  return {
    reportType: reportType,
    reportTitle: reportTitle,
    metadata: {
      instansi: settingsMap['NAMA_INSTANSI'] || APP_CONFIG.INSTANSI,
      alamat: settingsMap['ALAMAT_INSTANSI'] || 'Jl. Kolonel Sutarto No. 58, Jebres, Kota Surakarta',
      telepon: settingsMap['TELEPON_INSTANSI'] || '(0271) 646505',
      kepalaMarkas: settingsMap['NAMA_KEPALA_MARKAS'] || 'Wanto, S.KM.',
      koordinatorGudang: settingsMap['NAMA_KOORDINATOR_GUDANG'] || 'Indro Sri Widodo',
      periode: periodeLabel,
      filterKategori: filterKategori,
      tanggalCetak: getCurrentTimestamp()
    },
    columns: columns,
    rows: rows,
    summary: summary
  };
}
