/**
 * ============================================================================
 * SISTEM INFORMASI MANAJEMEN STOK GUDANG - PMI KOTA SURAKARTA
 * File: Transaksi.gs
 * Deskripsi: Modul Transaksi Barang Masuk (GRN), Transaksi Barang Keluar (GDN)
 *            dengan validasi stok tersedia di sisi server, Kartu Stok (Stock Card)
 *            otomatis, dan mesin rekalkulasi STOCK_BALANCE.
 * ============================================================================
 */

/**
 * Menghitung ulang seluruh saldo stok dan nilai persediaan di server secara
 * konsisten berdasarkan data aktual MASTER_BARANG, TRANSAKSI_MASUK,
 * TRANSAKSI_KELUAR, dan STOCK_OPNAME yang berstatus APPROVED (Bab 14).
 */
function recalculateAllStockBalances() {
  var masters = getSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG);
  var masukList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK);
  var keluarList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR);
  var opnameList = getSheetRecords(APP_CONFIG.SHEETS.STOCK_OPNAME);

  var inSumMap = {};
  var nearestExpMap = {};

  for (var i = 0; i < masukList.length; i++) {
    var m = masukList[i];
    var idB = String(m.id_barang);
    var qtyIn = toNumber(m.jumlah_masuk, 0);
    inSumMap[idB] = (inSumMap[idB] || 0) + qtyIn;

    var exp = normalizeDateString(m.expired_date);
    if (exp && qtyIn > 0) {
      if (!nearestExpMap[idB] || exp < nearestExpMap[idB]) {
        nearestExpMap[idB] = exp;
      }
    }
  }

  var outSumMap = {};
  for (var j = 0; j < keluarList.length; j++) {
    var k = keluarList[j];
    var idBOut = String(k.id_barang);
    var qtyOut = toNumber(k.jumlah_keluar, 0);
    outSumMap[idBOut] = (outSumMap[idBOut] || 0) + qtyOut;
  }

  // Hanya Stock Opname dengan status_persetujuan === 'APPROVED' yang mengubah stok sistem (Bab 8)
  var opnameAdjMap = {};
  for (var o = 0; o < opnameList.length; o++) {
    var op = opnameList[o];
    if (String(op.status_persetujuan || '').toUpperCase() === 'APPROVED') {
      var idBOp = String(op.id_barang);
      var diff = toNumber(op.selisih, 0);
      opnameAdjMap[idBOp] = (opnameAdjMap[idBOp] || 0) + diff;
    }
  }

  var nowStr = getCurrentTimestamp();
  var balanceRows = [];

  for (var idx = 0; idx < masters.length; idx++) {
    var item = masters[idx];
    var idBarang = String(item.id_barang);
    var totalMasuk = toNumber(inSumMap[idBarang], 0);
    var totalKeluar = toNumber(outSumMap[idBarang], 0);
    var penyesuaian = toNumber(opnameAdjMap[idBarang], 0);

    // Rumus Utama: Saldo Akhir = Total Masuk - Total Keluar + Penyesuaian Opname Approved
    var saldoStok = totalMasuk - totalKeluar + penyesuaian;
    var hargaUnit = toNumber(item.harga_unit, 0);
    var totalNilai = saldoStok * hargaUnit;
    var stokMin = toNumber(item.stok_minimum, 0);

    var statusStok = 'TERSEDIA';
    if (saldoStok <= 0) {
      statusStok = 'HABIS';
    } else if (saldoStok <= stokMin) {
      statusStok = 'MENIPIS';
    }

    var nearestExp = (saldoStok > 0 && nearestExpMap[idBarang]) ? nearestExpMap[idBarang] : '';
    var expInfo = evaluateExpiryStatus(nearestExp);

    balanceRows.push({
      id_balance: 'BAL-' + idBarang,
      id_barang: idBarang,
      kode_barang: item.kode_barang,
      nama_barang: item.nama_barang,
      kategori: item.kategori,
      satuan: item.satuan,
      harga_unit: hargaUnit,
      sumber_donor: item.sumber_donor || '-',
      stok_awal: 0,
      total_masuk: totalMasuk,
      total_keluar: totalKeluar,
      penyesuaian_opname: penyesuaian,
      saldo_stok: saldoStok,
      total_nilai: totalNilai,
      nearest_expired_date: nearestExp,
      status_stok: statusStok,
      status_expired: expInfo.status,
      lokasi_rak: item.lokasi_rak || '-',
      last_updated: nowStr
    });
  }

  replaceAllSheetRecords(APP_CONFIG.SHEETS.STOCK_BALANCE, 'STOCK_BALANCE', balanceRows);
  return balanceRows;
}

/**
 * Menghitung saldo stok tersedia saat ini untuk 1 barang secara real-time di server.
 * Digunakan untuk memvalidasi Transaksi Barang Keluar (Bab 6 & Bab 14).
 */
function getCurrentItemAvailableStock(idBarang, excludeIdKeluar) {
  var targetId = String(idBarang || '').trim();
  var masukList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK);
  var keluarList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR);
  var opnameList = getSheetRecords(APP_CONFIG.SHEETS.STOCK_OPNAME);

  var totalIn = 0;
  for (var i = 0; i < masukList.length; i++) {
    if (String(masukList[i].id_barang) === targetId) {
      totalIn += toNumber(masukList[i].jumlah_masuk, 0);
    }
  }

  var totalOut = 0;
  for (var j = 0; j < keluarList.length; j++) {
    if (String(keluarList[j].id_barang) === targetId) {
      if (excludeIdKeluar && String(keluarList[j].id_keluar) === String(excludeIdKeluar)) {
        continue;
      }
      totalOut += toNumber(keluarList[j].jumlah_keluar, 0);
    }
  }

  var totalAdj = 0;
  for (var o = 0; o < opnameList.length; o++) {
    if (
      String(opnameList[o].id_barang) === targetId &&
      String(opnameList[o].status_persetujuan).toUpperCase() === 'APPROVED'
    ) {
      totalAdj += toNumber(opnameList[o].selisih, 0);
    }
  }

  return totalIn - totalOut + totalAdj;
}

/**
 * Mengambil daftar riwayat Transaksi Barang Masuk beserta nomor otomatis berikutnya (Bab 5).
 */
function getTransaksiMasukList(token, filters) {
  requireServerPermission(token, 'canViewStok');
  var list = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK);

  // Urutkan dari yang terbaru
  list.sort(function(a, b) {
    var dA = String(a.tanggal || '') + ' ' + String(a.created_at || '');
    var dB = String(b.tanggal || '') + ' ' + String(b.created_at || '');
    return dB.localeCompare(dA);
  });

  if (filters) {
    var kat = String(filters.kategori || '').toUpperCase().trim();
    var start = normalizeDateString(filters.startDate);
    var end = normalizeDateString(filters.endDate);
    var q = String(filters.search || '').toLowerCase().trim();

    list = list.filter(function(r) {
      if (kat && kat !== 'SEMUA' && String(r.kategori).toUpperCase() !== kat) return false;
      var tgl = normalizeDateString(r.tanggal);
      if (start && tgl < start) return false;
      if (end && tgl > end) return false;
      if (q) {
        var hay = (
          String(r.no_transaksi) + ' ' +
          String(r.kode_barang) + ' ' +
          String(r.nama_barang) + ' ' +
          String(r.no_grn) + ' ' +
          String(r.sumber_donor) + ' ' +
          String(r.catatan)
        ).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  var nextNo = generateAutoDocumentNumber(
    APP_CONFIG.SHEETS.TRANSAKSI_MASUK,
    'no_transaksi',
    APP_CONFIG.PREFIX.TRX_MASUK
  );

  return {
    transactions: list,
    nextAutoNumber: nextNo
  };
}

/**
 * Menyimpan (Tambah atau Edit) Transaksi Barang Masuk (Bab 5).
 * Edit transaksi dibatasi hanya untuk pengguna dengan hak canEditTransaksiMasuk (ADMIN).
 */
function saveTransaksiMasuk(token, payload) {
  var idMasuk = String(payload.id_masuk || '').trim();
  var requiredPerm = idMasuk ? 'canEditTransaksiMasuk' : 'canInputTransaksiMasuk';
  var auth = requireServerPermission(token, requiredPerm);

  return executeWithWarehouseLock(function() {
    var idBarang = String(payload.id_barang || '').trim();
    var tanggal = normalizeDateString(payload.tanggal) || getTodayDateString();
    var jumlahMasuk = toNumber(payload.jumlah_masuk, 0);
    var sumberDonor = String(payload.sumber_donor || '').trim();
    var noGrn = String(payload.no_grn || '').trim();
    var noRequest = String(payload.no_request || '-').trim();
    var expiredDate = normalizeDateString(payload.expired_date);
    var catatan = String(payload.catatan || '').trim();

    if (!idBarang) {
      throw new Error('Silakan pilih barang terlebih dahulu.');
    }
    if (jumlahMasuk <= 0) {
      throw new Error('Jumlah barang masuk harus lebih besar dari 0.');
    }

    // Ambil detail barang dari MASTER_BARANG
    var masters = getSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG);
    var masterItem = null;
    for (var i = 0; i < masters.length; i++) {
      if (String(masters[i].id_barang) === idBarang) {
        masterItem = masters[i];
        break;
      }
    }
    if (!masterItem) {
      throw new Error('Barang tidak ditemukan di Master Data Barang.');
    }

    var hargaUnit = payload.harga_unit !== undefined && payload.harga_unit !== ''
      ? toNumber(payload.harga_unit, toNumber(masterItem.harga_unit, 0))
      : toNumber(masterItem.harga_unit, 0);
    var totalNilai = jumlahMasuk * hargaUnit;

    // Upload dokumen pendukung jika ada
    var dokumenUrl = String(payload.dokumen_url || '').trim();
    if (payload.dokumen_base64 && payload.dokumen_name) {
      dokumenUrl = saveSupportingDocumentToDrive(
        payload.dokumen_base64,
        payload.dokumen_name,
        payload.dokumen_mime,
        'GRN_BARANG_MASUK'
      );
    }

    var now = getCurrentTimestamp();
    var existingList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK);

    if (!idMasuk) {
      // Pencegahan transaksi ganda dalam waktu berdekatan (Idempotency Check - Bab 14)
      for (var d = 0; d < existingList.length; d++) {
        var ex = existingList[d];
        if (
          noGrn &&
          noGrn !== '-' &&
          String(ex.no_grn).trim().toUpperCase() === noGrn.toUpperCase() &&
          String(ex.id_barang) === idBarang &&
          toNumber(ex.jumlah_masuk, 0) === jumlahMasuk &&
          normalizeDateString(ex.tanggal) === tanggal
        ) {
          throw new Error(
            'Transaksi ganda terdeteksi: Barang ini dengan Nomor GRN "' +
            noGrn +
            '" dan jumlah yang sama sudah tercatat pada tanggal tersebut.'
          );
        }
      }

      var autoNo = generateAutoDocumentNumber(
        APP_CONFIG.SHEETS.TRANSAKSI_MASUK,
        'no_transaksi',
        APP_CONFIG.PREFIX.TRX_MASUK
      );
      var newId = generateUniqueId('IN');
      var newRecord = {
        id_masuk: newId,
        no_transaksi: autoNo,
        tanggal: tanggal,
        id_barang: masterItem.id_barang,
        kode_barang: masterItem.kode_barang,
        nama_barang: masterItem.nama_barang,
        kategori: masterItem.kategori,
        jumlah_masuk: jumlahMasuk,
        satuan: masterItem.satuan,
        harga_unit: hargaUnit,
        total_nilai: totalNilai,
        sumber_donor: sumberDonor || masterItem.sumber_donor || '-',
        no_grn: noGrn || '-',
        no_request: noRequest || '-',
        expired_date: expiredDate,
        catatan: catatan,
        dokumen_url: dokumenUrl,
        created_at: now,
        created_by: auth.user.username,
        updated_at: now,
        updated_by: auth.user.username
      };

      insertSheetRecord(APP_CONFIG.SHEETS.TRANSAKSI_MASUK, 'TRANSAKSI_MASUK', newRecord);

      // Jika harga_unit baru > 0 dan berbeda, sinkronkan harga referensi di MASTER_BARANG
      if (hargaUnit > 0 && hargaUnit !== toNumber(masterItem.harga_unit, 0)) {
        updateSheetRecordById(APP_CONFIG.SHEETS.MASTER_BARANG, 'MASTER_BARANG', 'id_barang', masterItem.id_barang, {
          harga_unit: hargaUnit,
          updated_at: now
        });
      }

      recalculateAllStockBalances();

      logUserActivity(
        auth.user,
        'TRANSAKSI_MASUK',
        'CREATE_MASUK',
        autoNo,
        'Barang masuk: +' + jumlahMasuk + ' ' + masterItem.satuan + ' [' + masterItem.kode_barang + '] ' + masterItem.nama_barang
      );

      return {
        message: 'Transaksi Barang Masuk (' + autoNo + ') berhasil disimpan. Stok bertambah +' + jumlahMasuk + ' ' + masterItem.satuan + '.',
        transaction: newRecord
      };
    } else {
      // Validasi sebelum edit transaksi masuk: pastikan pengurangan jumlah masuk tidak menyebabkan saldo stok menjadi negatif
      var oldTx = null;
      for (var k = 0; k < existingList.length; k++) {
        if (String(existingList[k].id_masuk) === idMasuk) {
          oldTx = existingList[k];
          break;
        }
      }
      if (!oldTx) {
        throw new Error('Data transaksi masuk tidak ditemukan.');
      }

      var currentAvailable = getCurrentItemAvailableStock(oldTx.id_barang);
      if (String(oldTx.id_barang) === idBarang) {
        var projectedStock = currentAvailable - toNumber(oldTx.jumlah_masuk, 0) + jumlahMasuk;
        if (projectedStock < 0) {
          throw new Error(
            'Perubahan ditolak: Mengurangi jumlah masuk menjadi ' +
            jumlahMasuk +
            ' akan menyebabkan saldo stok akhir menjadi negatif (' +
            projectedStock +
            ').'
          );
        }
      } else {
        var oldItemProjected = currentAvailable - toNumber(oldTx.jumlah_masuk, 0);
        if (oldItemProjected < 0) {
          throw new Error('Perubahan barang ditolak karena stok barang sebelumnya sudah terpakai untuk transaksi keluar.');
        }
      }

      var updateFields = {
        tanggal: tanggal,
        id_barang: masterItem.id_barang,
        kode_barang: masterItem.kode_barang,
        nama_barang: masterItem.nama_barang,
        kategori: masterItem.kategori,
        jumlah_masuk: jumlahMasuk,
        satuan: masterItem.satuan,
        harga_unit: hargaUnit,
        total_nilai: totalNilai,
        sumber_donor: sumberDonor || masterItem.sumber_donor || '-',
        no_grn: noGrn || '-',
        no_request: noRequest || '-',
        expired_date: expiredDate,
        catatan: catatan,
        updated_at: now,
        updated_by: auth.user.username
      };
      if (dokumenUrl) {
        updateFields.dokumen_url = dokumenUrl;
      }

      updateSheetRecordById(APP_CONFIG.SHEETS.TRANSAKSI_MASUK, 'TRANSAKSI_MASUK', 'id_masuk', idMasuk, updateFields);
      recalculateAllStockBalances();

      logUserActivity(
        auth.user,
        'TRANSAKSI_MASUK',
        'UPDATE_MASUK',
        oldTx.no_transaksi,
        'Edit transaksi masuk ' + oldTx.no_transaksi + ': ' + jumlahMasuk + ' ' + masterItem.satuan + ' ' + masterItem.nama_barang
      );

      return {
        message: 'Transaksi Barang Masuk (' + oldTx.no_transaksi + ') berhasil diperbarui dan saldo stok telah disesuaikan.'
      };
    }
  });
}

/**
 * Menghapus Transaksi Barang Masuk (Hanya ADMIN, dengan validasi saldo stok tidak menjadi negatif).
 */
function deleteTransaksiMasuk(token, idMasuk, alasanHapus) {
  var auth = requireServerPermission(token, 'canEditTransaksiMasuk');
  return executeWithWarehouseLock(function() {
    var list = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK);
    var target = null;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id_masuk) === String(idMasuk)) {
        target = list[i];
        break;
      }
    }
    if (!target) {
      throw new Error('Transaksi barang masuk tidak ditemukan.');
    }

    var currentStock = getCurrentItemAvailableStock(target.id_barang);
    var stockAfterDelete = currentStock - toNumber(target.jumlah_masuk, 0);
    if (stockAfterDelete < 0) {
      throw new Error(
        'Penghapusan ditolak: Stok barang ini sudah didistribusikan. Menghapus transaksi masuk ini akan membuat saldo stok minus (' +
        stockAfterDelete +
        ').'
      );
    }

    deleteSheetRecordById(APP_CONFIG.SHEETS.TRANSAKSI_MASUK, 'TRANSAKSI_MASUK', 'id_masuk', idMasuk);
    recalculateAllStockBalances();

    logUserActivity(
      auth.user,
      'TRANSAKSI_MASUK',
      'DELETE_MASUK',
      target.no_transaksi,
      'Menghapus transaksi masuk ' + target.no_transaksi + ' (' + target.nama_barang + '). Alasan: ' + (alasanHapus || '-')
    );

    return {
      message: 'Transaksi Barang Masuk ' + target.no_transaksi + ' berhasil dihapus dan saldo stok telah diperbarui.'
    };
  });
}

/**
 * Mengambil daftar riwayat Transaksi Barang Keluar beserta nomor otomatis berikutnya (Bab 6).
 */
function getTransaksiKeluarList(token, filters) {
  requireServerPermission(token, 'canViewStok');
  var list = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR);

  list.sort(function(a, b) {
    var dA = String(a.tanggal || '') + ' ' + String(a.created_at || '');
    var dB = String(b.tanggal || '') + ' ' + String(b.created_at || '');
    return dB.localeCompare(dA);
  });

  if (filters) {
    var kat = String(filters.kategori || '').toUpperCase().trim();
    var start = normalizeDateString(filters.startDate);
    var end = normalizeDateString(filters.endDate);
    var q = String(filters.search || '').toLowerCase().trim();

    list = list.filter(function(r) {
      if (kat && kat !== 'SEMUA' && String(r.kategori).toUpperCase() !== kat) return false;
      var tgl = normalizeDateString(r.tanggal);
      if (start && tgl < start) return false;
      if (end && tgl > end) return false;
      if (q) {
        var hay = (
          String(r.no_transaksi) + ' ' +
          String(r.kode_barang) + ' ' +
          String(r.nama_barang) + ' ' +
          String(r.tujuan_distribusi) + ' ' +
          String(r.nama_penerima) + ' ' +
          String(r.no_gdn) + ' ' +
          String(r.catatan)
        ).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  var nextNo = generateAutoDocumentNumber(
    APP_CONFIG.SHEETS.TRANSAKSI_KELUAR,
    'no_transaksi',
    APP_CONFIG.PREFIX.TRX_KELUAR
  );

  return {
    transactions: list,
    nextAutoNumber: nextNo
  };
}

/**
 * Menyimpan (Tambah atau Edit) Transaksi Barang Keluar & Distribusi Bantuan (Bab 6).
 * ATURAN MUTLAK: Sistem wajib menolak transaksi apabila jumlah barang keluar melebihi stok tersedia!
 */
function saveTransaksiKeluar(token, payload) {
  var idKeluar = String(payload.id_keluar || '').trim();
  var requiredPerm = idKeluar ? 'canEditTransaksiKeluar' : 'canInputTransaksiKeluar';
  var auth = requireServerPermission(token, requiredPerm);

  return executeWithWarehouseLock(function() {
    var idBarang = String(payload.id_barang || '').trim();
    var tanggal = normalizeDateString(payload.tanggal) || getTodayDateString();
    var jumlahKeluar = toNumber(payload.jumlah_keluar, 0);
    var tujuanDistribusi = String(payload.tujuan_distribusi || '').trim();
    var namaPenerima = String(payload.nama_penerima || '').trim();
    var noGdn = String(payload.no_gdn || '').trim();
    var noRequest = String(payload.no_request || '-').trim();
    var penanggungJawab = String(payload.penanggung_jawab || auth.user.nama_lengkap).trim();
    var catatan = String(payload.catatan || '').trim();

    if (!idBarang) {
      throw new Error('Silakan pilih barang yang akan dikeluarkan.');
    }
    if (jumlahKeluar <= 0) {
      throw new Error('Jumlah barang keluar harus lebih besar dari 0.');
    }
    if (!tujuanDistribusi) {
      throw new Error('Tujuan Distribusi wajib diisi.');
    }
    if (!namaPenerima) {
      throw new Error('Nama Penerima wajib diisi.');
    }

    var masters = getSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG);
    var masterItem = null;
    for (var i = 0; i < masters.length; i++) {
      if (String(masters[i].id_barang) === idBarang) {
        masterItem = masters[i];
        break;
      }
    }
    if (!masterItem) {
      throw new Error('Barang tidak ditemukan di Master Data Barang.');
    }

    // VALIDASI STOK TERSEDIA DI SERVER (BAB 6 & BAB 14)
    var availableStock = getCurrentItemAvailableStock(idBarang, idKeluar || null);
    if (jumlahKeluar > availableStock) {
      throw new Error(
        'TRANSAKSI DITOLAK: Jumlah barang keluar (' +
        jumlahKeluar + ' ' + masterItem.satuan +
        ') melebihi saldo stok tersedia di gudang saat ini (' +
        availableStock + ' ' + masterItem.satuan +
        ') untuk barang [' + masterItem.kode_barang + '] ' + masterItem.nama_barang + '.'
      );
    }

    var hargaUnit = toNumber(masterItem.harga_unit, 0);
    var totalNilai = jumlahKeluar * hargaUnit;

    var dokumenUrl = String(payload.dokumen_url || '').trim();
    if (payload.dokumen_base64 && payload.dokumen_name) {
      dokumenUrl = saveSupportingDocumentToDrive(
        payload.dokumen_base64,
        payload.dokumen_name,
        payload.dokumen_mime,
        'GDN_BARANG_KELUAR'
      );
    }

    var now = getCurrentTimestamp();

    if (!idKeluar) {
      var autoNoOut = generateAutoDocumentNumber(
        APP_CONFIG.SHEETS.TRANSAKSI_KELUAR,
        'no_transaksi',
        APP_CONFIG.PREFIX.TRX_KELUAR
      );
      var autoNoDist = generateAutoDocumentNumber(
        APP_CONFIG.SHEETS.DISTRIBUSI,
        'no_distribusi',
        APP_CONFIG.PREFIX.DISTRIBUSI
      );
      var newIdOut = generateUniqueId('OUT');

      var outRecord = {
        id_keluar: newIdOut,
        no_transaksi: autoNoOut,
        tanggal: tanggal,
        id_barang: masterItem.id_barang,
        kode_barang: masterItem.kode_barang,
        nama_barang: masterItem.nama_barang,
        kategori: masterItem.kategori,
        jumlah_keluar: jumlahKeluar,
        satuan: masterItem.satuan,
        harga_unit: hargaUnit,
        total_nilai: totalNilai,
        tujuan_distribusi: tujuanDistribusi,
        nama_penerima: namaPenerima,
        no_gdn: noGdn || '-',
        no_request: noRequest || '-',
        penanggung_jawab: penanggungJawab,
        catatan: catatan,
        dokumen_url: dokumenUrl,
        created_at: now,
        created_by: auth.user.username,
        updated_at: now,
        updated_by: auth.user.username
      };

      insertSheetRecord(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR, 'TRANSAKSI_KELUAR', outRecord);

      // Catat pula ke sheet DISTRIBUSI untuk pelacakan penyaluran bantuan logistik
      insertSheetRecord(APP_CONFIG.SHEETS.DISTRIBUSI, 'DISTRIBUSI', {
        id_distribusi: generateUniqueId('DST'),
        no_distribusi: autoNoDist,
        id_keluar: newIdOut,
        no_transaksi_keluar: autoNoOut,
        tanggal: tanggal,
        id_barang: masterItem.id_barang,
        kode_barang: masterItem.kode_barang,
        nama_barang: masterItem.nama_barang,
        kategori: masterItem.kategori,
        jumlah: jumlahKeluar,
        satuan: masterItem.satuan,
        total_nilai: totalNilai,
        tujuan_distribusi: tujuanDistribusi,
        nama_penerima: namaPenerima,
        no_gdn: noGdn || '-',
        no_request: noRequest || '-',
        penanggung_jawab: penanggungJawab,
        status_distribusi: 'TERDISTRIBUSI',
        catatan: catatan,
        created_at: now,
        created_by: auth.user.username
      });

      recalculateAllStockBalances();

      var sisaStok = availableStock - jumlahKeluar;

      logUserActivity(
        auth.user,
        'TRANSAKSI_KELUAR',
        'CREATE_KELUAR',
        autoNoOut,
        'Barang keluar: -' + jumlahKeluar + ' ' + masterItem.satuan + ' [' + masterItem.kode_barang + '] ke ' + tujuanDistribusi + ' (Sisa stok: ' + sisaStok + ')'
      );

      return {
        message: 'Transaksi Barang Keluar (' + autoNoOut + ') berhasil disimpan. Stok berkurang -' + jumlahKeluar + ' ' + masterItem.satuan + ' (Sisa: ' + sisaStok + ' ' + masterItem.satuan + ').',
        transaction: outRecord
      };
    } else {
      var existingOut = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR);
      var oldOut = null;
      for (var k = 0; k < existingOut.length; k++) {
        if (String(existingOut[k].id_keluar) === idKeluar) {
          oldOut = existingOut[k];
          break;
        }
      }
      if (!oldOut) {
        throw new Error('Transaksi barang keluar tidak ditemukan.');
      }

      var updateOutFields = {
        tanggal: tanggal,
        id_barang: masterItem.id_barang,
        kode_barang: masterItem.kode_barang,
        nama_barang: masterItem.nama_barang,
        kategori: masterItem.kategori,
        jumlah_keluar: jumlahKeluar,
        satuan: masterItem.satuan,
        harga_unit: hargaUnit,
        total_nilai: totalNilai,
        tujuan_distribusi: tujuanDistribusi,
        nama_penerima: namaPenerima,
        no_gdn: noGdn || '-',
        no_request: noRequest || '-',
        penanggung_jawab: penanggungJawab,
        catatan: catatan,
        updated_at: now,
        updated_by: auth.user.username
      };
      if (dokumenUrl) {
        updateOutFields.dokumen_url = dokumenUrl;
      }

      updateSheetRecordById(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR, 'TRANSAKSI_KELUAR', 'id_keluar', idKeluar, updateOutFields);
      updateSheetRecordById(APP_CONFIG.SHEETS.DISTRIBUSI, 'DISTRIBUSI', 'id_keluar', idKeluar, {
        tanggal: tanggal,
        id_barang: masterItem.id_barang,
        kode_barang: masterItem.kode_barang,
        nama_barang: masterItem.nama_barang,
        kategori: masterItem.kategori,
        jumlah: jumlahKeluar,
        satuan: masterItem.satuan,
        total_nilai: totalNilai,
        tujuan_distribusi: tujuanDistribusi,
        nama_penerima: namaPenerima,
        no_gdn: noGdn || '-',
        no_request: noRequest || '-',
        penanggung_jawab: penanggungJawab,
        catatan: catatan
      });

      recalculateAllStockBalances();

      logUserActivity(
        auth.user,
        'TRANSAKSI_KELUAR',
        'UPDATE_KELUAR',
        oldOut.no_transaksi,
        'Edit transaksi keluar ' + oldOut.no_transaksi + ': -' + jumlahKeluar + ' ' + masterItem.satuan + ' ke ' + tujuanDistribusi
      );

      return {
        message: 'Transaksi Barang Keluar (' + oldOut.no_transaksi + ') berhasil diperbarui.'
      };
    }
  });
}

/**
 * Menghapus Transaksi Barang Keluar (Hanya ADMIN).
 */
function deleteTransaksiKeluar(token, idKeluar, alasanHapus) {
  var auth = requireServerPermission(token, 'canEditTransaksiKeluar');
  return executeWithWarehouseLock(function() {
    var list = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR);
    var target = null;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id_keluar) === String(idKeluar)) {
        target = list[i];
        break;
      }
    }
    if (!target) {
      throw new Error('Transaksi barang keluar tidak ditemukan.');
    }

    deleteSheetRecordById(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR, 'TRANSAKSI_KELUAR', 'id_keluar', idKeluar);
    deleteSheetRecordById(APP_CONFIG.SHEETS.DISTRIBUSI, 'DISTRIBUSI', 'id_keluar', idKeluar);
    recalculateAllStockBalances();

    logUserActivity(
      auth.user,
      'TRANSAKSI_KELUAR',
      'DELETE_KELUAR',
      target.no_transaksi,
      'Menghapus transaksi keluar ' + target.no_transaksi + ' (' + target.nama_barang + '). Alasan: ' + (alasanHapus || '-')
    );

    return {
      message: 'Transaksi Barang Keluar ' + target.no_transaksi + ' berhasil dihapus dan stok telah dikembalikan ke saldo gudang.'
    };
  });
}

/**
 * KARTU STOK / STOCK CARD OTOMATIS (Bab 7).
 * Menyusun buku besar (ledger) kronologis setiap barang dengan rumus:
 * Saldo Akhir = Saldo Sebelumnya + Barang Masuk - Barang Keluar.
 */
function getKartuStokBarang(token, payload) {
  requireServerPermission(token, 'canViewKartuStok');

  var idBarang = String(payload.id_barang || '').trim();
  var startDate = normalizeDateString(payload.startDate);
  var endDate = normalizeDateString(payload.endDate);

  if (!idBarang) {
    throw new Error('Pilih barang terlebih dahulu untuk menampilkan Kartu Stok.');
  }

  var masters = getSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG);
  var item = null;
  for (var i = 0; i < masters.length; i++) {
    if (String(masters[i].id_barang) === idBarang) {
      item = masters[i];
      break;
    }
  }
  if (!item) {
    throw new Error('Data barang tidak ditemukan.');
  }

  var hargaSatuanDefault = toNumber(item.harga_unit, 0);
  var masukList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK);
  var keluarList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR);
  var opnameList = getSheetRecords(APP_CONFIG.SHEETS.STOCK_OPNAME);

  var rawEvents = [];

  for (var m = 0; m < masukList.length; m++) {
    var txIn = masukList[m];
    if (String(txIn.id_barang) !== idBarang) continue;
    rawEvents.push({
      tanggal: normalizeDateString(txIn.tanggal),
      timestamp: String(txIn.created_at || txIn.tanggal || ''),
      orderPriority: 1,
      no_dokumen: (txIn.no_grn && txIn.no_grn !== '-') ? (txIn.no_transaksi + ' / ' + txIn.no_grn) : txIn.no_transaksi,
      jenis: 'MASUK',
      keterangan: txIn.catatan || 'Penerimaan Barang Masuk',
      masuk: toNumber(txIn.jumlah_masuk, 0),
      keluar: 0,
      harga_satuan: toNumber(txIn.harga_unit, hargaSatuanDefault),
      sumber_barang: txIn.sumber_donor || '-',
      tujuan_distribusi: '-'
    });
  }

  for (var k = 0; k < keluarList.length; k++) {
    var txOut = keluarList[k];
    if (String(txOut.id_barang) !== idBarang) continue;
    rawEvents.push({
      tanggal: normalizeDateString(txOut.tanggal),
      timestamp: String(txOut.created_at || txOut.tanggal || ''),
      orderPriority: 2,
      no_dokumen: (txOut.no_gdn && txOut.no_gdn !== '-') ? (txOut.no_transaksi + ' / ' + txOut.no_gdn) : txOut.no_transaksi,
      jenis: 'KELUAR',
      keterangan: txOut.catatan || ('Distribusi ke ' + txOut.tujuan_distribusi),
      masuk: 0,
      keluar: toNumber(txOut.jumlah_keluar, 0),
      harga_satuan: toNumber(txOut.harga_unit, hargaSatuanDefault),
      sumber_barang: '-',
      tujuan_distribusi: txOut.tujuan_distribusi + (txOut.nama_penerima ? ' (' + txOut.nama_penerima + ')' : '')
    });
  }

  for (var o = 0; o < opnameList.length; o++) {
    var op = opnameList[o];
    if (String(op.id_barang) !== idBarang) continue;
    if (String(op.status_persetujuan).toUpperCase() !== 'APPROVED') continue;
    var diff = toNumber(op.selisih, 0);
    if (diff === 0) continue;
    rawEvents.push({
      tanggal: normalizeDateString(op.tanggal_periksa || op.tanggal_jadwal),
      timestamp: String(op.tanggal_persetujuan || op.created_at || ''),
      orderPriority: 3,
      no_dokumen: op.no_opname,
      jenis: 'PENYESUAIAN OPNAME',
      keterangan: 'Penyesuaian Stock Opname Disetujui (' + (op.alasan_selisih || 'Opname Fisik') + ')',
      masuk: diff > 0 ? diff : 0,
      keluar: diff < 0 ? Math.abs(diff) : 0,
      harga_satuan: toNumber(op.harga_unit, hargaSatuanDefault),
      sumber_barang: diff > 0 ? 'Penyesuaian Opname (+)' : '-',
      tujuan_distribusi: diff < 0 ? 'Penyesuaian Opname (-)' : '-'
    });
  }

  // Urutkan mutasi secara kronologis dari tanggal terlama ke terbaru
  rawEvents.sort(function(a, b) {
    if (a.tanggal !== b.tanggal) {
      return a.tanggal.localeCompare(b.tanggal);
    }
    if (a.orderPriority !== b.orderPriority) {
      return a.orderPriority - b.orderPriority;
    }
    return a.timestamp.localeCompare(b.timestamp);
  });

  var runningBalance = 0;
  var saldoSebelumPeriode = 0;
  var filteredRows = [];
  var totalMasukPeriode = 0;
  var totalKeluarPeriode = 0;

  for (var e = 0; e < rawEvents.length; e++) {
    var ev = rawEvents[e];
    // Rumus Kartu Stok: Saldo Akhir = Saldo Sebelumnya + Barang Masuk - Barang Keluar
    var prevBalance = runningBalance;
    runningBalance = prevBalance + ev.masuk - ev.keluar;

    if (startDate && ev.tanggal < startDate) {
      saldoSebelumPeriode = runningBalance;
      continue;
    }
    if (endDate && ev.tanggal > endDate) {
      continue;
    }

    totalMasukPeriode += ev.masuk;
    totalKeluarPeriode += ev.keluar;

    filteredRows.push({
      tanggal: ev.tanggal,
      no_dokumen: ev.no_dokumen,
      jenis: ev.jenis,
      keterangan: ev.keterangan,
      saldo_sebelumnya: prevBalance,
      barang_masuk: ev.masuk,
      barang_keluar: ev.keluar,
      saldo_stok: runningBalance,
      harga_satuan: ev.harga_satuan,
      nilai_persediaan: runningBalance * ev.harga_satuan,
      sumber_barang: ev.sumber_barang,
      tujuan_distribusi: ev.tujuan_distribusi
    });
  }

  // Jika menggunakan filter startDate, tambahkan baris Saldo Awal Periode di bagian paling atas
  if (startDate) {
    filteredRows.unshift({
      tanggal: startDate,
      no_dokumen: 'SALDO-AWAL',
      jenis: 'SALDO AWAL PERIODE',
      keterangan: 'Saldo Stok Sebelum Tanggal ' + startDate,
      saldo_sebelumnya: saldoSebelumPeriode,
      barang_masuk: 0,
      barang_keluar: 0,
      saldo_stok: saldoSebelumPeriode,
      harga_satuan: hargaSatuanDefault,
      nilai_persediaan: saldoSebelumPeriode * hargaSatuanDefault,
      sumber_barang: item.sumber_donor || '-',
      tujuan_distribusi: '-'
    });
  }

  var finalBalance = filteredRows.length > 0
    ? filteredRows[filteredRows.length - 1].saldo_stok
    : (startDate ? saldoSebelumPeriode : runningBalance);

  return {
    item: {
      id_barang: item.id_barang,
      kode_barang: item.kode_barang,
      nama_barang: item.nama_barang,
      kategori: item.kategori,
      subkategori: item.subkategori || '-',
      satuan: item.satuan,
      harga_unit: hargaSatuanDefault,
      sumber_donor: item.sumber_donor || '-',
      lokasi_rak: item.lokasi_rak || '-',
      stok_minimum: toNumber(item.stok_minimum, 0)
    },
    summary: {
      startDate: startDate || 'Awal Pencatatan',
      endDate: endDate || getTodayDateString(),
      saldoAwalPeriode: startDate ? saldoSebelumPeriode : 0,
      totalMasukPeriode: totalMasukPeriode,
      totalKeluarPeriode: totalKeluarPeriode,
      saldoAkhirPeriode: finalBalance,
      nilaiPersediaanAkhir: finalBalance * hargaSatuanDefault
    },
    ledger: filteredRows
  };
}
