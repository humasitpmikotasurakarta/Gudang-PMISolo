/**
 * ============================================================================
 * SISTEM INFORMASI MANAJEMEN STOK GUDANG - PMI KOTA SURAKARTA
 * File: Config.gs
 * Deskripsi: Konfigurasi utama aplikasi, identitas instansi, skema 10 sheet
 *            database Google Spreadsheet, kategori barang, dan matriks RBAC.
 * ============================================================================
 */

var APP_CONFIG = {
  APP_NAME: 'SISTEM INFORMASI MANAJEMEN STOK GUDANG',
  INSTANSI: 'PALANG MERAH INDONESIA KOTA SURAKARTA',
  SUBTITLE: 'Pengelolaan Logistik, Persediaan, dan Distribusi Bantuan',
  VERSION: '2.0.0',
  TIMEZONE: 'Asia/Jakarta',

  // Isi SPREADSHEET_ID jika menggunakan Standalone Script.
  // Kosongkan ('') jika script menempel langsung pada Google Spreadsheet (Container-Bound),
  // karena sistem akan menyimpan dan membaca ID secara otomatis dari PropertiesService.
  SPREADSHEET_ID: '',

  // Warna Identitas PMI
  COLORS: {
    PRIMARY_RED: '#D71920',
    DARK_RED: '#B01217',
    WHITE: '#FFFFFF',
    BLACK: '#202020',
    GRAY_HEADER: '#F1F5F9'
  },

  // 3 Kategori Utama Barang (Bab 2)
  CATEGORIES: {
    FOOD: 'FOOD ITEMS',
    NON_FOOD: 'NON FOOD',
    OBAT: 'OBAT'
  },

  // Prefix Kode Barang & Nomor Dokumen Otomatis
  PREFIX: {
    CATEGORY_CODE: {
      'FOOD ITEMS': 'FD',
      'NON FOOD': 'NF',
      'OBAT': 'OB'
    },
    TRX_MASUK: 'BM',
    TRX_KELUAR: 'BK',
    STOCK_OPNAME: 'SO',
    DISTRIBUSI: 'DST'
  },

  // Ambang Batas Monitoring Kedaluwarsa (Bab 9)
  EXPIRY_THRESHOLD: {
    SAFE_MIN_DAYS: 91,     // > 90 hari: AMAN
    WARNING_MIN_DAYS: 31,  // 31 - 90 hari: PERHATIAN
    URGENT_MIN_DAYS: 1     // 1 - 30 hari: SEGERA KEDALUWARSA, <= 0: KEDALUWARSA
  },

  // Nama 10 Sheet Database Utama (Bab 12)
  SHEETS: {
    USERS: 'USERS',
    MASTER_BARANG: 'MASTER_BARANG',
    TRANSAKSI_MASUK: 'TRANSAKSI_MASUK',
    TRANSAKSI_KELUAR: 'TRANSAKSI_KELUAR',
    STOCK_BALANCE: 'STOCK_BALANCE',
    STOCK_OPNAME: 'STOCK_OPNAME',
    DISTRIBUSI: 'DISTRIBUSI',
    DONOR_SUMBER: 'DONOR_SUMBER',
    LOG_AKTIVITAS: 'LOG_AKTIVITAS',
    SETTINGS: 'SETTINGS'
  },

  // Definisi Kolom untuk 10 Sheet Database
  HEADERS: {
    USERS: [
      'id_user',
      'username',
      'password_hash',
      'nama_lengkap',
      'role',
      'jabatan',
      'email',
      'no_hp',
      'status_aktif',
      'last_login',
      'created_at',
      'updated_at'
    ],
    MASTER_BARANG: [
      'id_barang',
      'kode_barang',
      'nama_barang',
      'kategori',
      'subkategori',
      'satuan',
      'harga_unit',
      'sumber_donor',
      'stok_minimum',
      'lokasi_rak',
      'has_expiry',
      'keterangan',
      'status_aktif',
      'created_at',
      'updated_at',
      'created_by'
    ],
    TRANSAKSI_MASUK: [
      'id_masuk',
      'no_transaksi',
      'tanggal',
      'id_barang',
      'kode_barang',
      'nama_barang',
      'kategori',
      'jumlah_masuk',
      'satuan',
      'harga_unit',
      'total_nilai',
      'sumber_donor',
      'no_grn',
      'no_request',
      'expired_date',
      'catatan',
      'dokumen_url',
      'created_at',
      'created_by',
      'updated_at',
      'updated_by'
    ],
    TRANSAKSI_KELUAR: [
      'id_keluar',
      'no_transaksi',
      'tanggal',
      'id_barang',
      'kode_barang',
      'nama_barang',
      'kategori',
      'jumlah_keluar',
      'satuan',
      'harga_unit',
      'total_nilai',
      'tujuan_distribusi',
      'nama_penerima',
      'no_gdn',
      'no_request',
      'penanggung_jawab',
      'catatan',
      'dokumen_url',
      'created_at',
      'created_by',
      'updated_at',
      'updated_by'
    ],
    STOCK_BALANCE: [
      'id_balance',
      'id_barang',
      'kode_barang',
      'nama_barang',
      'kategori',
      'satuan',
      'harga_unit',
      'sumber_donor',
      'stok_awal',
      'total_masuk',
      'total_keluar',
      'penyesuaian_opname',
      'saldo_stok',
      'total_nilai',
      'nearest_expired_date',
      'status_stok',
      'status_expired',
      'lokasi_rak',
      'last_updated'
    ],
    STOCK_OPNAME: [
      'id_opname',
      'no_opname',
      'tanggal_jadwal',
      'tanggal_periksa',
      'id_barang',
      'kode_barang',
      'nama_barang',
      'kategori',
      'satuan',
      'harga_unit',
      'stok_sistem',
      'stok_fisik',
      'selisih',
      'nilai_selisih',
      'alasan_selisih',
      'petugas_pemeriksa',
      'status_persetujuan',
      'disetujui_oleh',
      'tanggal_persetujuan',
      'catatan_admin',
      'created_at',
      'created_by'
    ],
    DISTRIBUSI: [
      'id_distribusi',
      'no_distribusi',
      'id_keluar',
      'no_transaksi_keluar',
      'tanggal',
      'id_barang',
      'kode_barang',
      'nama_barang',
      'kategori',
      'jumlah',
      'satuan',
      'total_nilai',
      'tujuan_distribusi',
      'nama_penerima',
      'no_gdn',
      'no_request',
      'penanggung_jawab',
      'status_distribusi',
      'catatan',
      'created_at',
      'created_by'
    ],
    DONOR_SUMBER: [
      'id_donor',
      'kode_donor',
      'nama_donor',
      'jenis_donor',
      'kontak',
      'alamat',
      'keterangan',
      'status_aktif',
      'created_at'
    ],
    LOG_AKTIVITAS: [
      'id_log',
      'timestamp',
      'id_user',
      'username',
      'nama_user',
      'role',
      'modul',
      'aksi',
      'referensi_id',
      'detail_aktivitas'
    ],
    SETTINGS: [
      'setting_key',
      'setting_value',
      'deskripsi',
      'updated_at',
      'updated_by'
    ]
  },

  // Level Akses & Hak Otorisasi (Bab 11)
  ROLES: {
    ADMIN: 'ADMIN',
    PETUGAS_GUDANG: 'PETUGAS GUDANG',
    PIMPINAN: 'PIMPINAN'
  },

  ROLE_PERMISSIONS: {
    'ADMIN': {
      canViewDashboard: true,
      canViewStok: true,
      canManageMasterBarang: true,
      canImportExcel: true,
      canInputTransaksiMasuk: true,
      canEditTransaksiMasuk: true,
      canInputTransaksiKeluar: true,
      canEditTransaksiKeluar: true,
      canViewKartuStok: true,
      canInputStockOpname: true,
      canApproveStockOpname: true,
      canViewExpired: true,
      canViewLaporan: true,
      canManageUsers: true,
      canViewLogs: true,
      canManageSettings: true
    },
    'PETUGAS GUDANG': {
      canViewDashboard: true,
      canViewStok: true,
      canManageMasterBarang: false,
      canImportExcel: false,
      canInputTransaksiMasuk: true,
      canEditTransaksiMasuk: false,
      canInputTransaksiKeluar: true,
      canEditTransaksiKeluar: false,
      canViewKartuStok: true,
      canInputStockOpname: true,
      canApproveStockOpname: false,
      canViewExpired: true,
      canViewLaporan: true,
      canManageUsers: false,
      canViewLogs: false,
      canManageSettings: false
    },
    'PIMPINAN': {
      canViewDashboard: true,
      canViewStok: true,
      canManageMasterBarang: false,
      canImportExcel: false,
      canInputTransaksiMasuk: false,
      canEditTransaksiMasuk: false,
      canInputTransaksiKeluar: false,
      canEditTransaksiKeluar: false,
      canViewKartuStok: true,
      canInputStockOpname: false,
      canApproveStockOpname: false,
      canViewExpired: true,
      canViewLaporan: true,
      canManageUsers: false,
      canViewLogs: false,
      canManageSettings: false
    }
  }
};
