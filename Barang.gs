/**
 * ============================================================================
 * SISTEM INFORMASI MANAJEMEN STOK GUDANG - PMI KOTA SURAKARTA
 * File: Barang.gs
 * Deskripsi: Pengelolaan Master Data Barang (3 Kategori: FOOD ITEMS, NON FOOD,
 *            OBAT), manajemen Donor/Sumber Barang, validasi keunikan Kode Barang,
 *            dan engine Migrasi Data cerdas dari file Stock Report Gudang PB.xlsx.
 * ============================================================================
 */

/**
 * Mengambil seluruh data Master Barang yang digabungkan dengan Saldo Stok terbaru
 * dari STOCK_BALANCE serta daftar Donor dari DONOR_SUMBER.
 */
function getMasterBarangWithBalance(token, filters) {
  requireServerPermission(token, 'canViewStok');

  var masterList = getSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG);
  var balanceList = getSheetRecords(APP_CONFIG.SHEETS.STOCK_BALANCE);
  var donors = getSheetRecords(APP_CONFIG.SHEETS.DONOR_SUMBER);

  // Jika STOCK_BALANCE belum sinkron dengan MASTER_BARANG, hitung ulang otomatis
  if (masterList.length > 0 && balanceList.length === 0) {
    balanceList = recalculateAllStockBalances();
  }

  var balanceMap = {};
  for (var i = 0; i < balanceList.length; i++) {
    var b = balanceList[i];
    balanceMap[String(b.id_barang)] = b;
  }

  var merged = [];
  for (var j = 0; j < masterList.length; j++) {
    var item = masterList[j];
    var bal = balanceMap[String(item.id_barang)] || {};
    var hargaUnit = toNumber(item.harga_unit, 0);
    var saldoStok = toNumber(bal.saldo_stok, 0);
    var totalNilai = toNumber(bal.total_nilai, saldoStok * hargaUnit);
    var stokMin = toNumber(item.stok_minimum, 0);

    var statusStok = 'TERSEDIA';
    if (saldoStok <= 0) {
      statusStok = 'HABIS';
    } else if (saldoStok <= stokMin) {
      statusStok = 'MENIPIS';
    }

    var expEval = evaluateExpiryStatus(bal.nearest_expired_date || '');

    merged.push({
      id_barang: item.id_barang,
      kode_barang: item.kode_barang,
      nama_barang: item.nama_barang,
      kategori: item.kategori,
      subkategori: item.subkategori || '-',
      satuan: item.satuan,
      harga_unit: hargaUnit,
      sumber_donor: item.sumber_donor || '-',
      stok_minimum: stokMin,
      lokasi_rak: item.lokasi_rak || '-',
      has_expiry: item.has_expiry || (item.kategori === 'NON FOOD' ? 'TIDAK' : 'YA'),
      keterangan: item.keterangan || '',
      status_aktif: item.status_aktif || 'AKTIF',
      stok_awal: toNumber(bal.stok_awal, 0),
      total_masuk: toNumber(bal.total_masuk, 0),
      total_keluar: toNumber(bal.total_keluar, 0),
      penyesuaian_opname: toNumber(bal.penyesuaian_opname, 0),
      saldo_stok: saldoStok,
      total_nilai: totalNilai,
      nearest_expired_date: expEval.expiredDate,
      days_to_expiry: expEval.daysRemaining,
      status_expired: expEval.status,
      status_stok: statusStok,
      updated_at: item.updated_at || item.created_at || ''
    });
  }

  return {
    items: merged,
    donors: donors
  };
}

/**
 * Menyimpan (Tambah atau Edit) Master Data Barang (Bab 4).
 * Kode barang wajib unik dan tidak boleh duplikat.
 */
function saveMasterBarang(token, payload) {
  var auth = requireServerPermission(token, 'canManageMasterBarang');
  return executeWithWarehouseLock(function() {
    var masterList = getSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG);

    var idBarang = String(payload.id_barang || '').trim();
    var kategori = String(payload.kategori || 'NON FOOD').toUpperCase().trim();
    var kodeBarang = String(payload.kode_barang || '').trim().toUpperCase();
    var namaBarang = String(payload.nama_barang || '').trim();
    var subkategori = String(payload.subkategori || '-').trim();
    var satuan = String(payload.satuan || 'Unit').trim();
    var hargaUnit = toNumber(payload.harga_unit, 0);
    var sumberDonor = String(payload.sumber_donor || '-').trim();
    var stokMinimum = toNumber(payload.stok_minimum, 0);
    var lokasiRak = String(payload.lokasi_rak || '-').trim();
    var hasExpiry = String(payload.has_expiry || (kategori === 'NON FOOD' ? 'TIDAK' : 'YA')).toUpperCase().trim();
    var keterangan = String(payload.keterangan || '').trim();
    var statusAktif = String(payload.status_aktif || 'AKTIF').toUpperCase().trim();

    if (!namaBarang) {
      throw new Error('Nama Barang wajib diisi.');
    }
    if (!satuan) {
      throw new Error('Satuan barang wajib diisi.');
    }
    if (
      kategori !== APP_CONFIG.CATEGORIES.FOOD &&
      kategori !== APP_CONFIG.CATEGORIES.NON_FOOD &&
      kategori !== APP_CONFIG.CATEGORIES.OBAT
    ) {
      throw new Error('Kategori tidak valid. Pilih FOOD ITEMS, NON FOOD, atau OBAT.');
    }
    if (hargaUnit < 0 || stokMinimum < 0) {
      throw new Error('Harga per unit dan stok minimum tidak boleh bernilai negatif.');
    }

    // Jika kode barang dikosongkan saat tambah baru, buatkan otomatis sesuai kategori
    if (!kodeBarang) {
      kodeBarang = generateAutoItemCode(kategori);
    }

    // Validasi keunikan Kode Barang
    for (var i = 0; i < masterList.length; i++) {
      var existingCode = String(masterList[i].kode_barang || '').trim().toUpperCase();
      var existingId = String(masterList[i].id_barang || '').trim();
      if (existingCode === kodeBarang && existingId !== idBarang) {
        throw new Error('Kode Barang "' + kodeBarang + '" sudah terdaftar untuk barang "' + masterList[i].nama_barang + '". Kode barang harus unik!');
      }
    }

    var now = getCurrentTimestamp();

    if (!idBarang) {
      var newId = generateUniqueId('BRG');
      var newRecord = {
        id_barang: newId,
        kode_barang: kodeBarang,
        nama_barang: namaBarang,
        kategori: kategori,
        subkategori: subkategori || '-',
        satuan: satuan,
        harga_unit: hargaUnit,
        sumber_donor: sumberDonor || '-',
        stok_minimum: stokMinimum,
        lokasi_rak: lokasiRak || '-',
        has_expiry: hasExpiry,
        keterangan: keterangan,
        status_aktif: statusAktif,
        created_at: now,
        updated_at: now,
        created_by: auth.user.username
      };

      insertSheetRecord(APP_CONFIG.SHEETS.MASTER_BARANG, 'MASTER_BARANG', newRecord);

      // Jika pengguna mengisi Stok Awal saat mendaftarkan barang baru, catat otomatis sebagai Transaksi Masuk Saldo Awal
      var stokAwal = toNumber(payload.stok_awal, 0);
      if (stokAwal > 0) {
        var autoNoIn = generateAutoDocumentNumber(APP_CONFIG.SHEETS.TRANSAKSI_MASUK, 'no_transaksi', APP_CONFIG.PREFIX.TRX_MASUK);
        var expAwal = normalizeDateString(payload.expired_date || '');
        insertSheetRecord(APP_CONFIG.SHEETS.TRANSAKSI_MASUK, 'TRANSAKSI_MASUK', {
          id_masuk: generateUniqueId('IN'),
          no_transaksi: autoNoIn,
          tanggal: getTodayDateString(),
          id_barang: newId,
          kode_barang: kodeBarang,
          nama_barang: namaBarang,
          kategori: kategori,
          jumlah_masuk: stokAwal,
          satuan: satuan,
          harga_unit: hargaUnit,
          total_nilai: stokAwal * hargaUnit,
          sumber_donor: sumberDonor || 'SALDO AWAL',
          no_grn: 'GRN/INIT/' + kodeBarang,
          no_request: '-',
          expired_date: expAwal,
          catatan: 'Saldo Stok Awal Master Barang',
          dokumen_url: '',
          created_at: now,
          created_by: auth.user.username,
          updated_at: now,
          updated_by: auth.user.username
        });
      }

      recalculateAllStockBalances();

      logUserActivity(
        auth.user,
        'MASTER_BARANG',
        'CREATE_BARANG',
        newId,
        'Menambahkan master barang: [' + kodeBarang + '] ' + namaBarang + ' (' + kategori + ')'
      );

      return {
        message: 'Data barang [' + kodeBarang + '] ' + namaBarang + ' berhasil ditambahkan.',
        item: newRecord
      };
    } else {
      var updatedFields = {
        kode_barang: kodeBarang,
        nama_barang: namaBarang,
        kategori: kategori,
        subkategori: subkategori || '-',
        satuan: satuan,
        harga_unit: hargaUnit,
        sumber_donor: sumberDonor || '-',
        stok_minimum: stokMinimum,
        lokasi_rak: lokasiRak || '-',
        has_expiry: hasExpiry,
        keterangan: keterangan,
        status_aktif: statusAktif,
        updated_at: now
      };

      var updated = updateSheetRecordById(
        APP_CONFIG.SHEETS.MASTER_BARANG,
        'MASTER_BARANG',
        'id_barang',
        idBarang,
        updatedFields
      );

      if (!updated) {
        throw new Error('Barang dengan ID "' + idBarang + '" tidak ditemukan.');
      }

      recalculateAllStockBalances();

      logUserActivity(
        auth.user,
        'MASTER_BARANG',
        'UPDATE_BARANG',
        idBarang,
        'Memperbarui master barang: [' + kodeBarang + '] ' + namaBarang
      );

      return {
        message: 'Data barang [' + kodeBarang + '] ' + namaBarang + ' berhasil diperbarui.'
      };
    }
  });
}

/**
 * Menghapus Master Data Barang (dengan proteksi integritas transaksi).
 */
function deleteMasterBarang(token, idBarang) {
  var auth = requireServerPermission(token, 'canManageMasterBarang');
  return executeWithWarehouseLock(function() {
    var cleanId = String(idBarang || '').trim();
    if (!cleanId) {
      throw new Error('ID Barang tidak valid.');
    }

    var masterList = getSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG);
    var target = null;
    for (var i = 0; i < masterList.length; i++) {
      if (String(masterList[i].id_barang) === cleanId) {
        target = masterList[i];
        break;
      }
    }

    if (!target) {
      throw new Error('Data barang tidak ditemukan.');
    }

    // Cek apakah barang sudah memiliki riwayat transaksi masuk/keluar
    var masukList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK);
    var keluarList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR);
    var hasHistory = false;

    for (var m = 0; m < masukList.length; m++) {
      if (String(masukList[m].id_barang) === cleanId) {
        hasHistory = true;
        break;
      }
    }
    if (!hasHistory) {
      for (var k = 0; k < keluarList.length; k++) {
        if (String(keluarList[k].id_barang) === cleanId) {
          hasHistory = true;
          break;
        }
      }
    }

    if (hasHistory) {
      // Nonaktifkan agar histori kartu stok tidak rusak
      updateSheetRecordById(APP_CONFIG.SHEETS.MASTER_BARANG, 'MASTER_BARANG', 'id_barang', cleanId, {
        status_aktif: 'NONAKTIF',
        updated_at: getCurrentTimestamp()
      });
      recalculateAllStockBalances();
      logUserActivity(
        auth.user,
        'MASTER_BARANG',
        'DEACTIVATE_BARANG',
        cleanId,
        'Menonaktifkan barang yang sudah memiliki histori transaksi: [' + target.kode_barang + '] ' + target.nama_barang
      );
      return {
        message: 'Barang [' + target.kode_barang + '] sudah memiliki riwayat transaksi sehingga statusnya diubah menjadi NONAKTIF demi menjaga keutuhan Kartu Stok.'
      };
    }

    deleteSheetRecordById(APP_CONFIG.SHEETS.MASTER_BARANG, 'MASTER_BARANG', 'id_barang', cleanId);
    deleteSheetRecordById(APP_CONFIG.SHEETS.STOCK_BALANCE, 'STOCK_BALANCE', 'id_barang', cleanId);

    recalculateAllStockBalances();

    logUserActivity(
      auth.user,
      'MASTER_BARANG',
      'DELETE_BARANG',
      cleanId,
      'Menghapus master barang: [' + target.kode_barang + '] ' + target.nama_barang
    );

    return {
      message: 'Barang [' + target.kode_barang + '] ' + target.nama_barang + ' berhasil dihapus.'
    };
  });
}

/**
 * Menambah atau memperbarui data Donor / Sumber Barang pada sheet DONOR_SUMBER.
 */
function saveDonorRecord(token, payload) {
  var auth = requireServerPermission(token, 'canManageMasterBarang');
  return executeWithWarehouseLock(function() {
    var kodeDonor = String(payload.kode_donor || '').trim().toUpperCase();
    var namaDonor = String(payload.nama_donor || '').trim();
    if (!kodeDonor || !namaDonor) {
      throw new Error('Kode Sumber dan Nama Sumber wajib diisi.');
    }

    var donors = getSheetRecords(APP_CONFIG.SHEETS.DONOR_SUMBER);
    for (var i = 0; i < donors.length; i++) {
      if (String(donors[i].kode_donor).toUpperCase() === kodeDonor) {
        updateSheetRecordById(APP_CONFIG.SHEETS.DONOR_SUMBER, 'DONOR_SUMBER', 'id_donor', donors[i].id_donor, {
          nama_donor: namaDonor,
          jenis_donor: payload.jenis_donor || donors[i].jenis_donor,
          kontak: payload.kontak || donors[i].kontak,
          alamat: payload.alamat || donors[i].alamat,
          keterangan: payload.keterangan || donors[i].keterangan
        });
        return { message: 'Data sumber ' + kodeDonor + ' berhasil diperbarui.' };
      }
    }

    var newDonor = {
      id_donor: generateUniqueId('DNR'),
      kode_donor: kodeDonor,
      nama_donor: namaDonor,
      jenis_donor: String(payload.jenis_donor || 'Mitra Sumber').trim(),
      kontak: String(payload.kontak || '-').trim(),
      alamat: String(payload.alamat || '-').trim(),
      keterangan: String(payload.keterangan || '').trim(),
      status_aktif: 'AKTIF',
      created_at: getCurrentTimestamp()
    };

    insertSheetRecord(APP_CONFIG.SHEETS.DONOR_SUMBER, 'DONOR_SUMBER', newDonor);
    logUserActivity(auth.user, 'SUMBER', 'CREATE_SUMBER', newDonor.id_donor, 'Menambah sumber: ' + namaDonor);
    return { message: 'Sumber barang baru berhasil ditambahkan.', donor: newDonor };
  });
}

/**
 * MIGRASI DATA DARI EXCEL: Stock Report Gudang PB.xlsx (Bab 16).
 * Mendukung import multi-kategori (FOOD ITEMS, NON FOOD, OBAT),
 * membedakan baris Master Barang, baris Transaksi Masuk/Keluar, serta baris
 * catatan komponen kedaluwarsa (seperti komponen Hygiene Kit), tanpa membuat
 * master barang ganda.
 */
function importExcelBatchData(token, importPayload) {
  var auth = requireServerPermission(token, 'canImportExcel');
  return executeWithWarehouseLock(function() {
    var rows = (importPayload && importPayload.rows) ? importPayload.rows : [];
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('Tidak ada data baris Excel yang dikirim untuk diimpor.');
    }

    var masterList = getSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG);
    var masukList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK);
    var keluarList = getSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR);

    // Indeks Master Barang berdasarkan kode_barang dan (kategori + nama_barang)
    var byCode = {};
    var byCatName = {};
    for (var i = 0; i < masterList.length; i++) {
      var m = masterList[i];
      var cKey = String(m.kode_barang || '').trim().toUpperCase();
      var nKey = String(m.kategori || '').toUpperCase() + '::' + String(m.nama_barang || '').trim().toLowerCase();
      if (cKey) byCode[cKey] = m;
      byCatName[nKey] = m;
    }

    // Counter penomoran otomatis
    var ym = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyyMM');
    var seqIn = masukList.length + 1;
    var seqOut = keluarList.length + 1;

    var catCounters = { 'FOOD ITEMS': 0, 'NON FOOD': 0, 'OBAT': 0 };
    for (var j = 0; j < masterList.length; j++) {
      var cat = String(masterList[j].kategori || 'NON FOOD').toUpperCase();
      if (catCounters[cat] !== undefined) catCounters[cat]++;
    }

    var newMasters = [];
    var newMasuk = [];
    var newKeluar = [];
    var newDistribusi = [];

    var stats = {
      totalRowsProcessed: rows.length,
      masterCreated: 0,
      masterMatched: 0,
      transaksiMasukCreated: 0,
      transaksiKeluarCreated: 0,
      skippedOrFailed: 0,
      errors: []
    };

    var now = getCurrentTimestamp();
    var today = getTodayDateString();
    var lastActiveMaster = null;

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      try {
        var kategori = String(row.kategori || 'NON FOOD').toUpperCase().trim();
        if (
          kategori !== APP_CONFIG.CATEGORIES.FOOD &&
          kategori !== APP_CONFIG.CATEGORIES.NON_FOOD &&
          kategori !== APP_CONFIG.CATEGORIES.OBAT
        ) {
          kategori = APP_CONFIG.CATEGORIES.NON_FOOD;
        }

        var rawKode = String(row.kode_barang || '').trim().toUpperCase();
        var rawNama = String(row.nama_barang || '').trim();
        var satuan = String(row.satuan || '').trim() || (lastActiveMaster ? lastActiveMaster.satuan : 'Unit');
        var harga = toNumber(row.harga_unit, lastActiveMaster ? lastActiveMaster.harga_unit : 0);
        var donor = String(row.sumber_donor || '').trim() || (lastActiveMaster ? lastActiveMaster.sumber_donor : '-');
        var noGrn = String(row.no_grn || row.no_dokumen || '').trim();
        var noGdn = String(row.no_gdn || '').trim();
        var noReq = String(row.no_request || '').trim();
        var tujuan = String(row.tujuan_distribusi || '').trim();
        var tglTrx = normalizeDateString(row.tanggal) || today;
        var expDate = normalizeDateString(row.expired_date);
        var keterangan = String(row.keterangan || row.catatan || '').trim();

        var stokAwal = toNumber(row.stok_awal, 0);
        var qtyMasuk = toNumber(row.barang_masuk, 0);
        var qtyKeluar = toNumber(row.barang_keluar, 0);
        var saldoExcel = toNumber(row.saldo_stok, 0);

        // Abaikan baris header berulang atau baris Total/Subtotal/Signature
        var upperName = rawNama.toUpperCase();
        if (
          upperName === 'TOTAL' ||
          upperName.indexOf('TOTAL :') === 0 ||
          upperName === 'JUMLAH' ||
          upperName === 'SUB TOTAL' ||
          upperName === 'NAMA BARANG' ||
          upperName.indexOf('LEMBAR KERJA') !== -1 ||
          upperName.indexOf('MENGETAHUI') !== -1 ||
          upperName.indexOf('KABAG PB') !== -1
        ) {
          stats.skippedOrFailed++;
          continue;
        }

        // Cari atau tentukan Master Barang untuk baris ini
        var targetMaster = null;

        if (!rawNama && !rawKode && lastActiveMaster) {
          // Baris transaksi lanjutan untuk barang pada baris di atasnya (format buku besar Stock Report Gudang PB.xlsx)
          targetMaster = lastActiveMaster;
          stats.masterMatched++;
        } else if (rawNama || rawKode) {
          var nLookup = kategori + '::' + rawNama.toLowerCase();
          if (rawKode && byCode[rawKode]) {
            targetMaster = byCode[rawKode];
            stats.masterMatched++;
          } else if (rawNama && byCatName[nLookup]) {
            targetMaster = byCatName[nLookup];
            stats.masterMatched++;
          } else if (rawNama) {
            // Buat Master Barang Baru
            catCounters[kategori] = (catCounters[kategori] || 0) + 1;
            var pref = APP_CONFIG.PREFIX.CATEGORY_CODE[kategori] || 'BRG';
            var generatedCode = rawKode;
            if (!generatedCode || byCode[generatedCode]) {
              generatedCode = pref + '-' + ('0000' + catCounters[kategori]).slice(-4);
              while (byCode[generatedCode]) {
                catCounters[kategori]++;
                generatedCode = pref + '-' + ('0000' + catCounters[kategori]).slice(-4);
              }
            }

            targetMaster = {
              id_barang: generateUniqueId('BRG'),
              kode_barang: generatedCode,
              nama_barang: rawNama,
              kategori: kategori,
              subkategori: String(row.subkategori || 'Logistik Gudang PB').trim(),
              satuan: satuan || 'Unit',
              harga_unit: harga,
              sumber_donor: donor || '-',
              stok_minimum: toNumber(row.stok_minimum, 10),
              lokasi_rak: String(row.lokasi_rak || 'GUDANG-PB').trim(),
              has_expiry: (expDate || kategori !== 'NON FOOD') ? 'YA' : 'TIDAK',
              keterangan: keterangan || 'Migrasi Stock Report Gudang PB.xlsx',
              status_aktif: 'AKTIF',
              created_at: now,
              updated_at: now,
              created_by: auth.user.username
            };

            newMasters.push(targetMaster);
            byCode[generatedCode] = targetMaster;
            byCatName[nLookup] = targetMaster;
            stats.masterCreated++;
          }
        }

        if (!targetMaster) {
          stats.skippedOrFailed++;
          continue;
        }

        lastActiveMaster = targetMaster;

        // Perbarui atribut master barang jika baris lanjutan menyertakan harga, donor, atau expired date komponen
        if (harga > 0 && toNumber(targetMaster.harga_unit, 0) === 0) {
          targetMaster.harga_unit = harga;
        }
        if (donor && donor !== '-' && (!targetMaster.sumber_donor || targetMaster.sumber_donor === '-')) {
          targetMaster.sumber_donor = donor;
        }
        if (expDate) {
          targetMaster.has_expiry = 'YA';
        }

        // Hitung total penambahan stok (Stok Awal + Barang Masuk)
        var totalInQty = 0;
        if (stokAwal > 0 && qtyMasuk > 0) {
          totalInQty = stokAwal + qtyMasuk;
        } else if (stokAwal > 0) {
          totalInQty = stokAwal;
        } else if (qtyMasuk > 0) {
          totalInQty = qtyMasuk;
        } else if (
          row._rowType === 'MASTER + SALDO' &&
          stokAwal === 0 &&
          qtyMasuk === 0 &&
          qtyKeluar === 0 &&
          saldoExcel > 0
        ) {
          // Hanya untuk baris master utama yang langsung mencantumkan saldo tanpa rincian masuk/keluar
          totalInQty = saldoExcel;
        }

        if (totalInQty > 0) {
          var noTrxIn = APP_CONFIG.PREFIX.TRX_MASUK + '-' + ym + '-' + ('0000' + seqIn).slice(-4);
          seqIn++;
          var unitPriceIn = harga > 0 ? harga : toNumber(targetMaster.harga_unit, 0);
          newMasuk.push({
            id_masuk: generateUniqueId('IN'),
            no_transaksi: noTrxIn,
            tanggal: tglTrx,
            id_barang: targetMaster.id_barang,
            kode_barang: targetMaster.kode_barang,
            nama_barang: targetMaster.nama_barang,
            kategori: targetMaster.kategori,
            jumlah_masuk: totalInQty,
            satuan: targetMaster.satuan,
            harga_unit: unitPriceIn,
            total_nilai: totalInQty * unitPriceIn,
            sumber_donor: donor !== '-' ? donor : targetMaster.sumber_donor,
            no_grn: noGrn || ('GRN/MIGRASI/' + targetMaster.kode_barang),
            no_request: noReq || '-',
            expired_date: expDate,
            catatan: keterangan || 'Migrasi Stock Report Gudang PB.xlsx',
            dokumen_url: '',
            created_at: now,
            created_by: auth.user.username,
            updated_at: now,
            updated_by: auth.user.username
          });
          stats.transaksiMasukCreated++;
        } else if (expDate && newMasuk.length > 0) {
          // Jika baris merupakan sub-item expired date (misal komponen Hygiene Kit: Pasta Gigi 2027-11-11, Shampo 2027-01-23),
          // gabungkan catatan komponen dan ambil expired_date terdekat pada transaksi masuk barang tersebut
          for (var mIdx = newMasuk.length - 1; mIdx >= 0; mIdx--) {
            if (newMasuk[mIdx].id_barang === targetMaster.id_barang) {
              var compNote = keterangan ? (keterangan + ' (Exp: ' + expDate + ')') : ('Exp: ' + expDate);
              if (newMasuk[mIdx].catatan.indexOf(compNote) === -1) {
                newMasuk[mIdx].catatan = (newMasuk[mIdx].catatan ? newMasuk[mIdx].catatan + '; ' : '') + compNote;
              }
              if (!newMasuk[mIdx].expired_date || expDate < newMasuk[mIdx].expired_date) {
                newMasuk[mIdx].expired_date = expDate;
              }
              break;
            }
          }
        }

        // Jika terdapat Barang Keluar > 0, buat Transaksi Keluar & Distribusi
        if (qtyKeluar > 0) {
          var noTrxOut = APP_CONFIG.PREFIX.TRX_KELUAR + '-' + ym + '-' + ('0000' + seqOut).slice(-4);
          var noDist = APP_CONFIG.PREFIX.DISTRIBUSI + '-' + ym + '-' + ('0000' + seqOut).slice(-4);
          seqOut++;
          var idOut = generateUniqueId('OUT');
          var unitPriceOut = harga > 0 ? harga : toNumber(targetMaster.harga_unit, 0);
          var destText = tujuan || keterangan || 'Distribusi Gudang PB';

          newKeluar.push({
            id_keluar: idOut,
            no_transaksi: noTrxOut,
            tanggal: tglTrx,
            id_barang: targetMaster.id_barang,
            kode_barang: targetMaster.kode_barang,
            nama_barang: targetMaster.nama_barang,
            kategori: targetMaster.kategori,
            jumlah_keluar: qtyKeluar,
            satuan: targetMaster.satuan,
            harga_unit: unitPriceOut,
            total_nilai: qtyKeluar * unitPriceOut,
            tujuan_distribusi: destText,
            nama_penerima: String(row.nama_penerima || destText).trim(),
            no_gdn: noGdn || ('GDN/MIGRASI/' + targetMaster.kode_barang),
            no_request: noReq || '-',
            penanggung_jawab: auth.user.nama_lengkap,
            catatan: keterangan || 'Migrasi pengeluaran Stock Report Gudang PB.xlsx',
            dokumen_url: '',
            created_at: now,
            created_by: auth.user.username,
            updated_at: now,
            updated_by: auth.user.username
          });

          newDistribusi.push({
            id_distribusi: generateUniqueId('DST'),
            no_distribusi: noDist,
            id_keluar: idOut,
            no_transaksi_keluar: noTrxOut,
            tanggal: tglTrx,
            id_barang: targetMaster.id_barang,
            kode_barang: targetMaster.kode_barang,
            nama_barang: targetMaster.nama_barang,
            kategori: targetMaster.kategori,
            jumlah: qtyKeluar,
            satuan: targetMaster.satuan,
            total_nilai: qtyKeluar * unitPriceOut,
            tujuan_distribusi: destText,
            nama_penerima: String(row.nama_penerima || destText).trim(),
            no_gdn: noGdn || ('GDN/MIGRASI/' + targetMaster.kode_barang),
            no_request: noReq || '-',
            penanggung_jawab: auth.user.nama_lengkap,
            status_distribusi: 'TERDISTRIBUSI',
            catatan: keterangan || 'Migrasi distribusi Stock Report Gudang PB.xlsx',
            created_at: now,
            created_by: auth.user.username
          });

          stats.transaksiKeluarCreated++;
        }
      } catch (rowErr) {
        stats.skippedOrFailed++;
        stats.errors.push('Baris #' + (r + 1) + ': ' + rowErr.message);
      }
    }

    // Batch write ke Google Spreadsheet
    if (newMasters.length > 0) {
      batchInsertSheetRecords(APP_CONFIG.SHEETS.MASTER_BARANG, 'MASTER_BARANG', newMasters);
    }
    if (newMasuk.length > 0) {
      batchInsertSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_MASUK, 'TRANSAKSI_MASUK', newMasuk);
    }
    if (newKeluar.length > 0) {
      batchInsertSheetRecords(APP_CONFIG.SHEETS.TRANSAKSI_KELUAR, 'TRANSAKSI_KELUAR', newKeluar);
    }
    if (newDistribusi.length > 0) {
      batchInsertSheetRecords(APP_CONFIG.SHEETS.DISTRIBUSI, 'DISTRIBUSI', newDistribusi);
    }

    recalculateAllStockBalances();

    logUserActivity(
      auth.user,
      'MIGRASI_EXCEL',
      'IMPORT_EXCEL',
      'BATCH-' + stats.totalRowsProcessed,
      'Import Excel selesai: ' +
        stats.masterCreated + ' barang baru, ' +
        stats.transaksiMasukCreated + ' transaksi masuk, ' +
        stats.transaksiKeluarCreated + ' transaksi keluar.'
    );

    return {
      message: 'Import data Excel selesai dijalankan!',
      stats: stats
    };
  });
}
