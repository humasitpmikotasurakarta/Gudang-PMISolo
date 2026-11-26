/**
 * ============================================================================
 * SISTEM INFORMASI MANAJEMEN STOK GUDANG - PMI KOTA SURAKARTA
 * File: StockOpname.gs
 * Deskripsi: Modul Stock Opname untuk pemeriksaan fisik persediaan gudang,
 *            perhitungan selisih stok, pencatatan alasan selisih & petugas,
 *            mekanisme persetujuan (approval) oleh Administrator, dan data
 *            Berita Acara Stock Opname (Bab 8).
 * ============================================================================
 */

/**
 * Mengambil daftar riwayat Stock Opname beserta nomor dokumen otomatis berikutnya.
 */
function getStockOpnameList(token, filters) {
  requireServerPermission(token, 'canViewStok');
  var list = getSheetRecords(APP_CONFIG.SHEETS.STOCK_OPNAME);

  list.sort(function(a, b) {
    var dA = String(a.tanggal_periksa || '') + ' ' + String(a.created_at || '');
    var dB = String(b.tanggal_periksa || '') + ' ' + String(b.created_at || '');
    return dB.localeCompare(dA);
  });

  if (filters) {
    var kat = String(filters.kategori || '').toUpperCase().trim();
    var st = String(filters.status || '').toUpperCase().trim();
    var q = String(filters.search || '').toLowerCase().trim();

    list = list.filter(function(r) {
      if (kat && kat !== 'SEMUA' && String(r.kategori).toUpperCase() !== kat) return false;
      if (st && st !== 'SEMUA' && String(r.status_persetujuan).toUpperCase() !== st) return false;
      if (q) {
        var hay = (
          String(r.no_opname) + ' ' +
          String(r.kode_barang) + ' ' +
          String(r.nama_barang) + ' ' +
          String(r.petugas_pemeriksa) + ' ' +
          String(r.alasan_selisih)
        ).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  var nextNo = generateAutoDocumentNumber(
    APP_CONFIG.SHEETS.STOCK_OPNAME,
    'no_opname',
    APP_CONFIG.PREFIX.STOCK_OPNAME
  );

  return {
    records: list,
    nextAutoNumber: nextNo
  };
}

/**
 * Menyimpan hasil input pemeriksaan fisik Stock Opname (satu barang atau banyak barang sekaligus).
 * ATURAN BAB 8: Stok sistem TIDAK BOLEH berubah sebelum hasil penyesuaian disetujui
 * oleh Administrator berwenang (disimpan dengan status_persetujuan = 'PENDING').
 */
function saveStockOpnameBatch(token, payload) {
  var auth = requireServerPermission(token, 'canInputStockOpname');
  return executeWithWarehouseLock(function() {
    var tanggalJadwal = normalizeDateString(payload.tanggal_jadwal) || getTodayDateString();
    var tanggalPeriksa = normalizeDateString(payload.tanggal_periksa) || getTodayDateString();
    var petugasPemeriksa = String(payload.petugas_pemeriksa || auth.user.nama_lengkap).trim();
    var itemsInput = Array.isArray(payload.items) ? payload.items : [];

    if (itemsInput.length === 0 && payload.id_barang) {
      itemsInput = [{
        id_barang: payload.id_barang,
        stok_fisik: payload.stok_fisik,
        alasan_selisih: payload.alasan_selisih
      }];
    }

    if (itemsInput.length === 0) {
      throw new Error('Tidak ada data barang yang dipilih untuk Stock Opname.');
    }
    if (!petugasPemeriksa) {
      throw new Error('Nama Petugas Pemeriksa wajib diisi.');
    }

    var masters = getSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG);
    var masterMap = {};
    for (var i = 0; i < masters.length; i++) {
      masterMap[String(masters[i].id_barang)] = masters[i];
    }

    var existingOpname = getSheetRecords(APP_CONFIG.SHEETS.STOCK_OPNAME);
    var ym = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyyMM');
    var seq = existingOpname.length + 1;
    var now = getCurrentTimestamp();
    var newRecords = [];

    for (var j = 0; j < itemsInput.length; j++) {
      var row = itemsInput[j];
      var idB = String(row.id_barang || '').trim();
      var master = masterMap[idB];
      if (!master) continue;

      if (row.stok_fisik === '' || row.stok_fisik === null || row.stok_fisik === undefined) {
        continue;
      }

      var stokFisik = toNumber(row.stok_fisik, 0);
      if (stokFisik < 0) {
        throw new Error('Jumlah stok fisik untuk barang ' + master.nama_barang + ' tidak boleh bernilai negatif.');
      }

      // Hitung stok sistem aktual saat pemeriksaan dilakukan
      var stokSistem = getCurrentItemAvailableStock(idB);
      var selisih = stokFisik - stokSistem;
      var hargaUnit = toNumber(master.harga_unit, 0);
      var nilaiSelisih = selisih * hargaUnit;
      var alasan = String(row.alasan_selisih || (selisih === 0 ? 'Sesuai fisik gudang' : 'Selisih pemeriksaan fisik')).trim();

      var noOpname = APP_CONFIG.PREFIX.STOCK_OPNAME + '-' + ym + '-' + ('0000' + seq).slice(-4);
      seq++;

      newRecords.push({
        id_opname: generateUniqueId('SO'),
        no_opname: noOpname,
        tanggal_jadwal: tanggalJadwal,
        tanggal_periksa: tanggalPeriksa,
        id_barang: master.id_barang,
        kode_barang: master.kode_barang,
        nama_barang: master.nama_barang,
        kategori: master.kategori,
        satuan: master.satuan,
        harga_unit: hargaUnit,
        stok_sistem: stokSistem,
        stok_fisik: stokFisik,
        selisih: selisih,
        nilai_selisih: nilaiSelisih,
        alasan_selisih: alasan,
        petugas_pemeriksa: petugasPemeriksa,
        status_persetujuan: 'PENDING',
        disetujui_oleh: '-',
        tanggal_persetujuan: '',
        catatan_admin: 'Menunggu persetujuan Administrator',
        created_at: now,
        created_by: auth.user.username
      });
    }

    if (newRecords.length === 0) {
      throw new Error('Silakan isi jumlah fisik minimal pada 1 barang yang diperiksa.');
    }

    batchInsertSheetRecords(APP_CONFIG.SHEETS.STOCK_OPNAME, 'STOCK_OPNAME', newRecords);

    // Catatan penting: Kita TIDAK mengubah saldo stok sistem di sini karena statusnya masih PENDING.
    logUserActivity(
      auth.user,
      'STOCK_OPNAME',
      'CREATE_OPNAME',
      newRecords[0].no_opname,
      'Menginput ' + newRecords.length + ' item hasil pemeriksaan fisik Stock Opname (Status: PENDING - Menunggu Persetujuan Admin).'
    );

    return {
      message: newRecords.length + ' data pemeriksaan Stock Opname berhasil disimpan dengan status PENDING. Stok sistem hanya akan berubah setelah disetujui oleh Administrator.',
      records: newRecords
    };
  });
}

/**
 * Persetujuan (APPROVE) atau Penolakan (REJECT) hasil Stock Opname oleh Administrator (Bab 8).
 * Ketika disetujui (APPROVED), barulah stok sistem di STOCK_BALANCE otomatis disesuaikan.
 */
function approveOrRejectStockOpname(token, payload) {
  var auth = requireServerPermission(token, 'canApproveStockOpname');
  return executeWithWarehouseLock(function() {
    var idOpname = String(payload.id_opname || '').trim();
    var decision = String(payload.decision || '').toUpperCase().trim(); // 'APPROVED' atau 'REJECTED'
    var catatanAdmin = String(payload.catatan_admin || '').trim();

    if (!idOpname) {
      throw new Error('ID Stock Opname wajib disertakan.');
    }
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new Error('Keputusan harus berupa APPROVED (Disetujui) atau REJECTED (Ditolak).');
    }

    var opnameList = getSheetRecords(APP_CONFIG.SHEETS.STOCK_OPNAME);
    var target = null;
    for (var i = 0; i < opnameList.length; i++) {
      if (String(opnameList[i].id_opname) === idOpname) {
        target = opnameList[i];
        break;
      }
    }

    if (!target) {
      throw new Error('Data Stock Opname tidak ditemukan.');
    }

    if (String(target.status_persetujuan).toUpperCase() !== 'PENDING') {
      throw new Error('Stock Opname ' + target.no_opname + ' sudah diproses sebelumnya (' + target.status_persetujuan + ').');
    }

    // Jika APPROVED, hitung ulang selisih terhadap stok sistem saat ini agar saldo akhir akurat sesuai stok fisik
    var currentSystemStock = getCurrentItemAvailableStock(target.id_barang);
    var stokFisik = toNumber(target.stok_fisik, 0);
    var finalSelisih = stokFisik - currentSystemStock;
    var hargaUnit = toNumber(target.harga_unit, 0);
    var now = getCurrentTimestamp();

    var updateFields = {
      stok_sistem: currentSystemStock,
      selisih: finalSelisih,
      nilai_selisih: finalSelisih * hargaUnit,
      status_persetujuan: decision,
      disetujui_oleh: auth.user.nama_lengkap + ' (' + auth.user.username + ')',
      tanggal_persetujuan: now,
      catatan_admin: catatanAdmin || (decision === 'APPROVED' ? 'Disetujui & stok disesuaikan' : 'Ditolak oleh Administrator')
    };

    updateSheetRecordById(APP_CONFIG.SHEETS.STOCK_OPNAME, 'STOCK_OPNAME', 'id_opname', idOpname, updateFields);

    // Rekalkulasi STOCK_BALANCE jika disetujui
    if (decision === 'APPROVED') {
      recalculateAllStockBalances();
    }

    logUserActivity(
      auth.user,
      'STOCK_OPNAME',
      decision + '_OPNAME',
      target.no_opname,
      'Administrator ' + (decision === 'APPROVED' ? 'MENYETUJUI' : 'MENOLAK') +
        ' Stock Opname ' + target.no_opname + ' untuk barang [' + target.kode_barang + '] ' + target.nama_barang +
        ' (Stok Sistem: ' + currentSystemStock + ', Fisik: ' + stokFisik + ', Selisih: ' + finalSelisih + ')'
    );

    return {
      message: decision === 'APPROVED'
        ? 'Stock Opname ' + target.no_opname + ' telah DISETUJUI. Saldo stok sistem untuk "' + target.nama_barang + '" kini telah disesuaikan menjadi ' + stokFisik + ' ' + target.satuan + '.'
        : 'Stock Opname ' + target.no_opname + ' telah DITOLAK. Saldo stok sistem tidak mengalami perubahan.'
    };
  });
}
