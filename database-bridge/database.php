<?php
/**
 * database.php
 *
 * The ONLY file that talks to MySQL. Deployed on cPanel, alongside the
 * EXISTING database (rxtdhqwu_house_rental_db) — this file does NOT create,
 * rename, or migrate any table. Every query below matches your real schema
 * exactly: rooms, tenants, rent_amounts, area_multipliers, areas,
 * area_balances, invoice, balance_sheet, bbilt, master_contral, expenses,
 * tenant_admission, webhook_queue.
 *
 * Deliberately NOT touched anywhere in this file, per your existing schema
 * review: `payments`, `mpesa_payments`, `rent_balances`, `rent_payments` —
 * all empty, all legacy. If you're actually still using one of those from
 * some other script, say so and I'll wire it up; otherwise they're just
 * left alone.
 *
 * Contract:
 *   POST /database.php
 *   Header: X-API-Key: <shared secret>
 *   Body (JSON): { "action": "<whitelisted action name>", "params": { ... } }
 *   Response (JSON): { "ok": true, "data": ... } | { "ok": false, "error": "..." }
 */

declare(strict_types=1);
header('Content-Type: application/json');

require_once __DIR__ . '/config.php'; // defines DB_SERVER, DB_USER, DB_PASS, DB_NAME, API_KEY

// ---------------------------------------------------------------------
// BASIC RATE LIMITING (best-effort, file-based)
// ---------------------------------------------------------------------
function rateLimitCheck(): void {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $dir = sys_get_temp_dir() . '/dana_bridge_rl';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    $file = $dir . '/' . md5($ip) . '.json';
    $now = time();
    $window = 60;
    $limit = 120;

    $state = ['start' => $now, 'count' => 0];
    if (is_file($file)) {
        $decoded = json_decode((string)file_get_contents($file), true);
        if (is_array($decoded)) {
            $state = $decoded;
        }
    }
    if ($now - $state['start'] > $window) {
        $state = ['start' => $now, 'count' => 0];
    }
    $state['count']++;
    @file_put_contents($file, json_encode($state));

    if ($state['count'] > $limit) {
        http_response_code(429);
        echo json_encode(['ok' => false, 'error' => 'Rate limit exceeded']);
        exit;
    }
}
rateLimitCheck();

// ---------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------
$providedKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
if (!hash_equals(API_KEY, $providedKey)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Unauthorized']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

// ---------------------------------------------------------------------
// PARSE BODY
// ---------------------------------------------------------------------
$raw = file_get_contents('php://input');
$body = json_decode($raw, true);

if (!is_array($body) || empty($body['action'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing action']);
    exit;
}

$action = (string)$body['action'];
$params = is_array($body['params'] ?? null) ? $body['params'] : [];

// ---------------------------------------------------------------------
// DB CONNECTION
// ---------------------------------------------------------------------
$con = mysqli_connect(DB_SERVER, DB_USER, DB_PASS, DB_NAME);
if (mysqli_connect_errno()) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'DB connection failed']);
    exit;
}
mysqli_set_charset($con, 'utf8mb4');

// ---------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------
function respond($data): void {
    echo json_encode(['ok' => true, 'data' => $data]);
    exit;
}

function fail(string $message, int $code = 400): void {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}

function fetchAll(mysqli_stmt $stmt): array {
    $result = $stmt->get_result();
    $rows = [];
    while ($row = $result->fetch_assoc()) {
        $rows[] = $row;
    }
    return $rows;
}

function fetchOne(mysqli_stmt $stmt) {
    $rows = fetchAll($stmt);
    return $rows[0] ?? null;
}

function newId(): string {
    return bin2hex(random_bytes(8));
}

function requireParams(array $params, array $keys): void {
    foreach ($keys as $key) {
        if (!array_key_exists($key, $params) || $params[$key] === '' || $params[$key] === null) {
            fail("Missing required param: {$key}");
        }
    }
}

/**
 * Writes/updates the balance_sheet row for an invoice once its final
 * amount_paid is known (called whenever an invoice's status becomes
 * 'paid'). balance = amount_paid - total_amount, matching the convention
 * already present in your existing balance_sheet data (positive = credit
 * carried into the next invoice, negative = still owed).
 */
function upsertBalanceSheet(mysqli $con, string $invoiceId): void {
    $stmt = $con->prepare("SELECT amount_paid, total_amount FROM invoice WHERE invoice_id = ? LIMIT 1");
    $stmt->bind_param('s', $invoiceId);
    $stmt->execute();
    $invoice = fetchOne($stmt);
    if (!$invoice) {
        return;
    }
    $balance = (float)$invoice['amount_paid'] - (float)$invoice['total_amount'];

    $existing = $con->prepare("SELECT id FROM balance_sheet WHERE invoice_id = ? LIMIT 1");
    $existing->bind_param('s', $invoiceId);
    $existing->execute();
    $row = fetchOne($existing);

    if ($row) {
        $upd = $con->prepare("UPDATE balance_sheet SET balance = ?, created_at = NOW() WHERE id = ?");
        $upd->bind_param('di', $balance, $row['id']);
        $upd->execute();
    } else {
        $ins = $con->prepare(
            "INSERT INTO balance_sheet (invoice_id, balance, created_at, status) VALUES (?, ?, NOW(), 'last_month')"
        );
        $ins->bind_param('sd', $invoiceId, $balance);
        $ins->execute();
    }
}

// ---------------------------------------------------------------------
// ACTION WHITELIST
// ---------------------------------------------------------------------
switch ($action) {

    // ================= ROOMS =================
    case 'getRooms': {
        $stmt = $con->prepare(
            "SELECT room_id, room_number, floor_number FROM rooms
             ORDER BY
               CASE
                 WHEN LOWER(floor_number) = 'ground floor' THEN 0
                 WHEN LOWER(floor_number) = 'first floor'  THEN 1
                 WHEN LOWER(floor_number) = 'second floor' THEN 2
                 WHEN LOWER(floor_number) = 'third floor'  THEN 3
                 WHEN LOWER(floor_number) = 'fourth floor' THEN 4
                 ELSE 5
               END ASC,
               room_number ASC"
        );
        $stmt->execute();
        respond(fetchAll($stmt));
    }

    case 'getRoom': {
        requireParams($params, ['room_id']);
        $stmt = $con->prepare("SELECT room_id, room_number, floor_number FROM rooms WHERE room_id = ? LIMIT 1");
        $stmt->bind_param('s', $params['room_id']);
        $stmt->execute();
        respond(fetchOne($stmt));
    }

    case 'createRoom': {
        requireParams($params, ['room_number', 'floor_number']);
        $roomId = newId();
        $roomNumber = (string)$params['room_number'];
        $floorNumber = (string)$params['floor_number'];
        $stmt = $con->prepare("INSERT INTO rooms (room_id, room_number, floor_number) VALUES (?, ?, ?)");
        $stmt->bind_param('sss', $roomId, $roomNumber, $floorNumber);
        if (!$stmt->execute()) {
            fail('Could not create room (is the room number already in use?)', 409);
        }
        respond(['room_id' => $roomId]);
    }

    case 'updateRoom': {
        requireParams($params, ['room_id', 'room_number', 'floor_number']);
        $stmt = $con->prepare("UPDATE rooms SET room_number = ?, floor_number = ? WHERE room_id = ?");
        $stmt->bind_param('sss', $params['room_number'], $params['floor_number'], $params['room_id']);
        $stmt->execute();
        respond(['updated' => $stmt->affected_rows > 0]);
    }

    case 'deleteRoom': {
        requireParams($params, ['room_id']);
        $stmt = $con->prepare("DELETE FROM rooms WHERE room_id = ?");
        $stmt->bind_param('s', $params['room_id']);
        if (!$stmt->execute()) {
            fail('Could not delete room — it likely still has tenants, rent, or invoices attached', 409);
        }
        respond(['deleted' => $stmt->affected_rows > 0]);
    }

    // ================= TENANTS =================
    // NOTE: tenants.room_id is NOT NULL in your schema — every tenant must
    // be assigned to a room at creation time. There's no "unassigned
    // tenant" state.
    case 'getTenants': {
        $stmt = $con->prepare(
            "SELECT t.tenant_id, t.room_id, t.tenant_name, t.phone_number, t.ID_number,
                    r.room_number, ta.admission_date
             FROM tenants t
             JOIN rooms r ON r.room_id = t.room_id
             LEFT JOIN tenant_admission ta ON ta.tenant_id = t.tenant_id
             ORDER BY r.room_number ASC"
        );
        $stmt->execute();
        respond(fetchAll($stmt));
    }

    case 'getTenant': {
        requireParams($params, ['tenant_id']);
        $stmt = $con->prepare(
            "SELECT t.tenant_id, t.room_id, t.tenant_name, t.phone_number, t.ID_number, r.room_number
             FROM tenants t JOIN rooms r ON r.room_id = t.room_id
             WHERE t.tenant_id = ? LIMIT 1"
        );
        $stmt->bind_param('s', $params['tenant_id']);
        $stmt->execute();
        respond(fetchOne($stmt));
    }

    case 'createTenant': {
        requireParams($params, ['tenant_name', 'room_id']);
        $tenantId = newId();
        $tenantName = (string)$params['tenant_name'];
        $phoneNumber = (string)($params['phone_number'] ?? '');
        $idNumber = (string)($params['id_number'] ?? '');
        $roomId = (string)$params['room_id'];

        $stmt = $con->prepare(
            "INSERT INTO tenants (tenant_id, room_id, tenant_name, phone_number, ID_number) VALUES (?, ?, ?, ?, ?)"
        );
        $stmt->bind_param('sssss', $tenantId, $roomId, $tenantName, $phoneNumber, $idNumber);
        if (!$stmt->execute()) {
            fail('Could not create tenant', 409);
        }

        $admissionDate = (string)($params['admission_date'] ?? date('Y-m-d'));
        $admissionId = newId();
        $admStmt = $con->prepare("INSERT INTO tenant_admission (admission_id, tenant_id, admission_date) VALUES (?, ?, ?)");
        $admStmt->bind_param('sss', $admissionId, $tenantId, $admissionDate);
        $admStmt->execute();

        respond(['tenant_id' => $tenantId]);
    }

    case 'updateTenant': {
        requireParams($params, ['tenant_id', 'tenant_name', 'room_id']);
        $tenantName = (string)$params['tenant_name'];
        $phoneNumber = (string)($params['phone_number'] ?? '');
        $idNumber = (string)($params['id_number'] ?? '');
        $roomId = (string)$params['room_id'];
        $tenantId = (string)$params['tenant_id'];

        $stmt = $con->prepare(
            "UPDATE tenants SET tenant_name = ?, phone_number = ?, ID_number = ?, room_id = ? WHERE tenant_id = ?"
        );
        $stmt->bind_param('sssss', $tenantName, $phoneNumber, $idNumber, $roomId, $tenantId);
        $stmt->execute();
        respond(['updated' => $stmt->affected_rows > 0]);
    }

    case 'deleteTenant': {
        requireParams($params, ['tenant_id']);
        $stmt = $con->prepare("DELETE FROM tenants WHERE tenant_id = ?");
        $stmt->bind_param('s', $params['tenant_id']);
        $stmt->execute();
        respond(['deleted' => $stmt->affected_rows > 0]);
    }

    // ================= RENT =================
    case 'getRentAmounts': {
        $stmt = $con->prepare(
            "SELECT ra.rent_id, ra.room_id, ra.monthly_rent, r.room_number, r.floor_number
             FROM rent_amounts ra JOIN rooms r ON r.room_id = ra.room_id
             ORDER BY r.room_number ASC"
        );
        $stmt->execute();
        respond(fetchAll($stmt));
    }

    case 'getRentForRoom': {
        requireParams($params, ['room_id']);
        $stmt = $con->prepare("SELECT rent_id, room_id, monthly_rent FROM rent_amounts WHERE room_id = ? LIMIT 1");
        $stmt->bind_param('s', $params['room_id']);
        $stmt->execute();
        respond(fetchOne($stmt));
    }

    case 'upsertRentAmount': {
        // rent_amounts.room_id has no UNIQUE constraint in your schema, so
        // this checks for an existing row itself rather than relying on
        // ON DUPLICATE KEY — same net effect (one row per room), no schema
        // change needed.
        requireParams($params, ['room_id', 'monthly_rent']);
        $roomId = (string)$params['room_id'];
        $monthlyRent = (float)$params['monthly_rent'];

        $existing = $con->prepare("SELECT rent_id FROM rent_amounts WHERE room_id = ? LIMIT 1");
        $existing->bind_param('s', $roomId);
        $existing->execute();
        $row = fetchOne($existing);

        if ($row) {
            $upd = $con->prepare("UPDATE rent_amounts SET monthly_rent = ? WHERE rent_id = ?");
            $upd->bind_param('ds', $monthlyRent, $row['rent_id']);
            $upd->execute();
            respond(['rent_id' => $row['rent_id'], 'room_id' => $roomId, 'monthly_rent' => $monthlyRent]);
        }

        $rentId = newId();
        $ins = $con->prepare("INSERT INTO rent_amounts (rent_id, room_id, monthly_rent) VALUES (?, ?, ?)");
        $ins->bind_param('ssd', $rentId, $roomId, $monthlyRent);
        $ins->execute();
        respond(['rent_id' => $rentId, 'room_id' => $roomId, 'monthly_rent' => $monthlyRent]);
    }

    // ================= WATER (area_multipliers is a single settings row) =================
    case 'getCurrentAreaRate': {
        $stmt = $con->prepare("SELECT multiplier_id, cost_per_unit FROM area_multipliers LIMIT 1");
        $stmt->execute();
        respond(fetchOne($stmt));
    }

    case 'setAreaRate': {
        requireParams($params, ['cost_per_unit']);
        $costPerUnit = (float)$params['cost_per_unit'];

        $existing = $con->prepare("SELECT multiplier_id FROM area_multipliers LIMIT 1");
        $existing->execute();
        $row = fetchOne($existing);

        if ($row) {
            $upd = $con->prepare("UPDATE area_multipliers SET cost_per_unit = ? WHERE multiplier_id = ?");
            $upd->bind_param('ds', $costPerUnit, $row['multiplier_id']);
            $upd->execute();
            respond(['multiplier_id' => $row['multiplier_id'], 'cost_per_unit' => $costPerUnit]);
        }

        $id = newId();
        $ins = $con->prepare("INSERT INTO area_multipliers (multiplier_id, cost_per_unit) VALUES (?, ?)");
        $ins->bind_param('sd', $id, $costPerUnit);
        $ins->execute();
        respond(['multiplier_id' => $id, 'cost_per_unit' => $costPerUnit]);
    }

    case 'getAreasForMonth': {
        requireParams($params, ['month']);
        $stmt = $con->prepare(
            "SELECT a.area_id, a.room_id, a.month, a.area_type, a.units_used,
                    ab.amount_due, ab.amount_paid, r.room_number
             FROM areas a
             JOIN rooms r ON r.room_id = a.room_id
             LEFT JOIN area_balances ab ON ab.area_id = a.area_id
             WHERE a.month = ?
             ORDER BY r.room_number ASC"
        );
        $stmt->bind_param('s', $params['month']);
        $stmt->execute();
        respond(fetchAll($stmt));
    }

    case 'createAreaReading': {
        requireParams($params, ['room_id', 'month', 'units_used', 'amount_due']);
        $roomId = (string)$params['room_id'];
        $month = (string)$params['month'];
        $areaType = (string)($params['area_type'] ?? 'water');
        $unitsUsed = (float)$params['units_used'];
        $amountDue = (float)$params['amount_due'];

        $dupe = $con->prepare("SELECT area_id FROM areas WHERE room_id = ? AND month = ? AND area_type = ? LIMIT 1");
        $dupe->bind_param('sss', $roomId, $month, $areaType);
        $dupe->execute();
        if (fetchOne($dupe)) {
            fail('A reading already exists for this room, month, and area type', 409);
        }

        $areaId = newId();
        $stmt = $con->prepare("INSERT INTO areas (area_id, room_id, month, area_type, units_used) VALUES (?, ?, ?, ?, ?)");
        $stmt->bind_param('sssss', $areaId, $roomId, $month, $areaType, $unitsUsed);
        $stmt->execute();

        $balanceId = newId();
        $stmt2 = $con->prepare("INSERT INTO area_balances (balance_id, area_id, amount_due) VALUES (?, ?, ?)");
        $stmt2->bind_param('ssd', $balanceId, $areaId, $amountDue);
        $stmt2->execute();

        respond(['area_id' => $areaId, 'balance_id' => $balanceId]);
    }

    case 'getWaterBalanceForRoomMonth': {
        requireParams($params, ['room_id', 'month']);
        $stmt = $con->prepare(
            "SELECT ab.amount_due, ab.amount_paid
             FROM areas a JOIN area_balances ab ON ab.area_id = a.area_id
             WHERE a.room_id = ? AND a.month = ? AND a.area_type = 'water' LIMIT 1"
        );
        $stmt->bind_param('ss', $params['room_id'], $params['month']);
        $stmt->execute();
        respond(fetchOne($stmt));
    }

    // ================= INVOICES =================
    case 'getInvoicesForMonth': {
        requireParams($params, ['month']);
        $stmt = $con->prepare(
            "SELECT i.*, r.room_number, t.tenant_name, t.phone_number
             FROM invoice i
             JOIN rooms r ON r.room_id = i.room_id
             LEFT JOIN tenants t ON t.tenant_id = i.tenant_id
             WHERE i.invoice_month = ?
             ORDER BY r.room_number ASC"
        );
        $stmt->bind_param('s', $params['month']);
        $stmt->execute();
        respond(fetchAll($stmt));
    }

    case 'getLatestInvoiceForRoom': {
        requireParams($params, ['room_id', 'before_month']);
        $stmt = $con->prepare(
            "SELECT * FROM invoice WHERE room_id = ? AND invoice_month < ? ORDER BY invoice_month DESC LIMIT 1"
        );
        $stmt->bind_param('ss', $params['room_id'], $params['before_month']);
        $stmt->execute();
        respond(fetchOne($stmt));
    }

    case 'getBalanceSheetForInvoice': {
        requireParams($params, ['invoice_id']);
        $stmt = $con->prepare("SELECT * FROM balance_sheet WHERE invoice_id = ? LIMIT 1");
        $stmt->bind_param('s', $params['invoice_id']);
        $stmt->execute();
        respond(fetchOne($stmt));
    }

    case 'roomsWithTenants': {
        $stmt = $con->prepare(
            "SELECT r.room_id, r.room_number, t.tenant_id, ra.monthly_rent
             FROM rooms r
             JOIN tenants t ON t.room_id = r.room_id
             LEFT JOIN rent_amounts ra ON ra.room_id = r.room_id
             ORDER BY r.room_number ASC"
        );
        $stmt->execute();
        respond(fetchAll($stmt));
    }

    case 'invoicesExistForMonth': {
        requireParams($params, ['month']);
        $stmt = $con->prepare("SELECT COUNT(*) AS cnt FROM invoice WHERE invoice_month = ?");
        $stmt->bind_param('s', $params['month']);
        $stmt->execute();
        $row = fetchOne($stmt);
        respond(['exists' => ((int)($row['cnt'] ?? 0)) > 0]);
    }

    case 'createInvoice': {
        requireParams($params, ['invoice_month', 'room_id', 'monthly_rent', 'area_balance', 'total_amount']);
        $id = newId();
        $invoiceMonth = (string)$params['invoice_month'];
        $roomId = (string)$params['room_id'];
        $tenantId = ($params['tenant_id'] ?? null) !== null && $params['tenant_id'] !== '' ? (string)$params['tenant_id'] : null;
        $monthlyRent = (float)$params['monthly_rent'];
        $areaBalance = (float)$params['area_balance'];
        $totalAmount = (float)$params['total_amount'];

        // 4 strings (id, invoice_month, room_id, tenant_id) then 3 doubles —
        // type string must be 'ssssddd', NOT 'sssdddd'.
        $stmt = $con->prepare(
            "INSERT INTO invoice (invoice_id, invoice_month, status, room_id, tenant_id, monthly_rent, area_balance, total_amount, created_at, amount_paid)
             VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, NOW(), 0)"
        );
        $stmt->bind_param('ssssddd', $id, $invoiceMonth, $roomId, $tenantId, $monthlyRent, $areaBalance, $totalAmount);
        $stmt->execute();
        respond(['id' => $id]);
    }

    case 'markInvoicePaid': {
        requireParams($params, ['invoice_id']);
        $invoiceId = (string)$params['invoice_id'];
        $stmt = $con->prepare("UPDATE invoice SET status = 'paid', amount_paid = total_amount WHERE invoice_id = ?");
        $stmt->bind_param('s', $invoiceId);
        $stmt->execute();
        if ($stmt->affected_rows > 0) {
            upsertBalanceSheet($con, $invoiceId);
        }
        respond(['updated' => $stmt->affected_rows > 0]);
    }

    case 'markAllInvoicesPaidForMonth': {
        requireParams($params, ['month']);
        $month = (string)$params['month'];

        $idsStmt = $con->prepare("SELECT invoice_id FROM invoice WHERE invoice_month = ? AND status != 'paid'");
        $idsStmt->bind_param('s', $month);
        $idsStmt->execute();
        $ids = array_column(fetchAll($idsStmt), 'invoice_id');

        $upd = $con->prepare("UPDATE invoice SET status = 'paid', amount_paid = total_amount WHERE invoice_month = ?");
        $upd->bind_param('s', $month);
        $upd->execute();

        foreach ($ids as $invoiceId) {
            upsertBalanceSheet($con, $invoiceId);
        }

        respond(['updated_rows' => $upd->affected_rows]);
    }

    case 'closeMonthBalances': {
        // Run once on the 25th of each month. Writes/updates a balance_sheet
        // row for EVERY invoice in `month`, regardless of status — not just
        // ones that got marked paid. This is what lets next month's
        // generation carry forward whatever's still owed (or credited),
        // per your rule: balance_sheet = amount_paid - total_amount;
        // +10 next month means "rent - 10", -10 means "rent + 10".
        requireParams($params, ['month']);
        $month = (string)$params['month'];

        $idsStmt = $con->prepare("SELECT invoice_id FROM invoice WHERE invoice_month = ?");
        $idsStmt->bind_param('s', $month);
        $idsStmt->execute();
        $ids = array_column(fetchAll($idsStmt), 'invoice_id');

        foreach ($ids as $invoiceId) {
            upsertBalanceSheet($con, $invoiceId);
        }

        respond(['closed' => count($ids)]);
    }

    case 'applyPaymentToInvoice': {
        // Only used for the >= KES 5,000 "this is a rent payment" path (see
        // reconcileWebhookPayload in lib/invoice-service.ts). Your original
        // description was a straight pending -> paid flip once covered, so
        // there's no intermediate 'waiting' state here.
        requireParams($params, ['invoice_id', 'amount']);
        $invoiceId = (string)$params['invoice_id'];
        $amount = (float)$params['amount'];
        $mpesaCode = (string)($params['mpesa_code'] ?? '');
        $phoneNumber = (string)($params['phone_number'] ?? '');

        $stmt = $con->prepare(
            "UPDATE invoice
             SET amount_paid = amount_paid + ?,
                 mpesa_code = ?,
                 number = ?,
                 status = CASE WHEN amount_paid + ? >= total_amount THEN 'paid' ELSE status END
             WHERE invoice_id = ?"
        );
        $stmt->bind_param('dssds', $amount, $mpesaCode, $phoneNumber, $amount, $invoiceId);
        $stmt->execute();

        $check = $con->prepare("SELECT status FROM invoice WHERE invoice_id = ? LIMIT 1");
        $check->bind_param('s', $invoiceId);
        $check->execute();
        $row = fetchOne($check);
        if ($row && $row['status'] === 'paid') {
            upsertBalanceSheet($con, $invoiceId);
        }

        respond(['updated' => $stmt->affected_rows > 0]);
    }

    case 'dashboardCounts': {
        $roomStmt = $con->prepare("SELECT COUNT(*) AS cnt FROM rooms");
        $roomStmt->execute();
        $rooms = fetchOne($roomStmt);

        $tenantStmt = $con->prepare("SELECT COUNT(*) AS cnt FROM tenants");
        $tenantStmt->execute();
        $tenants = fetchOne($tenantStmt);

        // "Payments this month" spans both payment paths: rent (>= KES 5,000,
        // landed on invoice.amount_paid, tracked by invoice.updated_at) and
        // water top-ups (< KES 5,000, landed on bbilt.amount_paid, tracked
        // by bbilt.created_at). window_start is provided by the caller and
        // already reflects the 1st-to-25th-then-reset rule.
        $windowStart = (string)($params['month_start'] ?? date('Y-m-01'));

        $stmtBbilt = $con->prepare("SELECT COALESCE(SUM(amount_paid), 0) AS total FROM bbilt WHERE created_at >= ?");
        $stmtBbilt->bind_param('s', $windowStart);
        $stmtBbilt->execute();
        $bbiltTotal = (float)(fetchOne($stmtBbilt)['total'] ?? 0);

        $stmtInvoice = $con->prepare(
            "SELECT COALESCE(SUM(amount_paid), 0) AS total FROM invoice WHERE amount_paid > 0 AND updated_at >= ?"
        );
        $stmtInvoice->bind_param('s', $windowStart);
        $stmtInvoice->execute();
        $invoiceTotal = (float)(fetchOne($stmtInvoice)['total'] ?? 0);

        respond([
            'room_count' => (int)($rooms['cnt'] ?? 0),
            'tenant_count' => (int)($tenants['cnt'] ?? 0),
            'payments_this_month' => $bbiltTotal + $invoiceTotal,
        ]);
    }

    // ================= BBILT (the live payments log) =================
    case 'createBbiltEntry': {
        requireParams($params, ['room_number', 'amount', 'amount_paid']);
        $roomNumber = (string)$params['room_number'];
        $amount = (float)$params['amount'];
        $amountPaid = (float)$params['amount_paid'];
        $mpesaNumber = (string)($params['mpesa_number'] ?? '');
        $mpesaCode = (string)($params['mpesa_code'] ?? '');

        $stmt = $con->prepare(
            "INSERT INTO bbilt (room_number, amount, amount_paid, mpesa_number, mpesa_code, created_at)
             VALUES (?, ?, ?, ?, ?, NOW())"
        );
        $stmt->bind_param('sddss', $roomNumber, $amount, $amountPaid, $mpesaNumber, $mpesaCode);
        $stmt->execute();
        respond(['id' => $con->insert_id]);
    }

    case 'getRecentBbilt': {
        $limit = max(1, min(200, (int)($params['limit'] ?? 50)));
        $stmt = $con->prepare("SELECT * FROM bbilt ORDER BY created_at DESC LIMIT ?");
        $stmt->bind_param('i', $limit);
        $stmt->execute();
        respond(fetchAll($stmt));
    }

    case 'findBbiltForRoomMonth': {
        // Used for the < KES 5,000 "this is a water top-up" path. Looks for
        // an existing bbilt row for this room created since the given
        // month started (bbilt has no month column of its own), so a
        // second small payment in the same month tops up the same row
        // instead of creating a new one every time.
        requireParams($params, ['room_number', 'month_start']);
        $stmt = $con->prepare(
            "SELECT * FROM bbilt WHERE room_number = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1"
        );
        $stmt->bind_param('ss', $params['room_number'], $params['month_start']);
        $stmt->execute();
        respond(fetchOne($stmt));
    }

    case 'updateBbiltPayment': {
        requireParams($params, ['id', 'amount_paid_delta']);
        $id = (int)$params['id'];
        $delta = (float)$params['amount_paid_delta'];
        $mpesaNumber = (string)($params['mpesa_number'] ?? '');
        $mpesaCode = (string)($params['mpesa_code'] ?? '');

        $stmt = $con->prepare(
            "UPDATE bbilt SET amount_paid = amount_paid + ?, mpesa_number = ?, mpesa_code = ? WHERE id = ?"
        );
        $stmt->bind_param('dssi', $delta, $mpesaNumber, $mpesaCode, $id);
        $stmt->execute();
        respond(['updated' => $stmt->affected_rows > 0]);
    }

    // ================= EXPENSES =================
    case 'getExpenses': {
        $stmt = $con->prepare("SELECT * FROM expenses ORDER BY expense_date DESC");
        $stmt->execute();
        respond(fetchAll($stmt));
    }

    case 'createExpense': {
        requireParams($params, ['expense_name', 'amount', 'expense_date']);
        $id = newId();
        $name = (string)$params['expense_name'];
        $amount = (float)$params['amount'];
        $date = (string)$params['expense_date'];
        $stmt = $con->prepare("INSERT INTO expenses (expense_id, expense_name, amount, expense_date) VALUES (?, ?, ?, ?)");
        $stmt->bind_param('ssds', $id, $name, $amount, $date);
        $stmt->execute();
        respond(['expense_id' => $id]);
    }

    case 'deleteExpense': {
        requireParams($params, ['expense_id']);
        $stmt = $con->prepare("DELETE FROM expenses WHERE expense_id = ?");
        $stmt->bind_param('s', $params['expense_id']);
        $stmt->execute();
        respond(['deleted' => $stmt->affected_rows > 0]);
    }

    // ================= ADMIN USERS (master_contral) =================
    case 'getUserByUsername': {
        requireParams($params, ['username']);
        $stmt = $con->prepare("SELECT id, username, password FROM master_contral WHERE username = ? LIMIT 1");
        $stmt->bind_param('s', $params['username']);
        $stmt->execute();
        respond(fetchOne($stmt));
    }

    case 'getUsers': {
        $stmt = $con->prepare("SELECT id, username FROM master_contral ORDER BY username ASC");
        $stmt->execute();
        respond(fetchAll($stmt));
    }

    case 'countUsers': {
        $stmt = $con->prepare("SELECT COUNT(*) AS cnt FROM master_contral");
        $stmt->execute();
        $row = fetchOne($stmt);
        respond(['count' => (int)($row['cnt'] ?? 0)]);
    }

    case 'createUser': {
        requireParams($params, ['username', 'password_hash']);
        $username = (string)$params['username'];
        $passwordHash = (string)$params['password_hash'];
        $stmt = $con->prepare("INSERT INTO master_contral (username, password) VALUES (?, ?)");
        $stmt->bind_param('ss', $username, $passwordHash);
        if (!$stmt->execute()) {
            fail('Username already exists', 409);
        }
        respond(['id' => $con->insert_id]);
    }

    case 'updateUser': {
        requireParams($params, ['id']);
        $id = (int)$params['id'];
        $hasPassword = !empty($params['password_hash']);
        $hasUsername = !empty($params['username']);

        if ($hasPassword && $hasUsername) {
            $stmt = $con->prepare("UPDATE master_contral SET username = ?, password = ? WHERE id = ?");
            $stmt->bind_param('ssi', $params['username'], $params['password_hash'], $id);
        } elseif ($hasPassword) {
            $stmt = $con->prepare("UPDATE master_contral SET password = ? WHERE id = ?");
            $stmt->bind_param('si', $params['password_hash'], $id);
        } elseif ($hasUsername) {
            $stmt = $con->prepare("UPDATE master_contral SET username = ? WHERE id = ?");
            $stmt->bind_param('si', $params['username'], $id);
        } else {
            fail('Nothing to update');
        }
        $stmt->execute();
        respond(['updated' => $stmt->affected_rows > 0]);
    }

    case 'deleteUser': {
        requireParams($params, ['id']);
        $id = (int)$params['id'];
        $countStmt = $con->prepare("SELECT COUNT(*) AS cnt FROM master_contral");
        $countStmt->execute();
        $count = (int)(fetchOne($countStmt)['cnt'] ?? 0);
        if ($count <= 1) {
            fail('Cannot delete the last remaining admin user', 409);
        }
        $stmt = $con->prepare("DELETE FROM master_contral WHERE id = ?");
        $stmt->bind_param('i', $id);
        $stmt->execute();
        respond(['deleted' => $stmt->affected_rows > 0]);
    }

    // ================= WEBHOOK QUEUE =================
    case 'enqueueWebhook': {
        requireParams($params, ['request_data']);
        $requestData = is_string($params['request_data']) ? $params['request_data'] : json_encode($params['request_data']);
        $stmt = $con->prepare("INSERT INTO webhook_queue (request_data, processed, created_at) VALUES (?, 0, NOW())");
        $stmt->bind_param('s', $requestData);
        $stmt->execute();
        respond(['id' => $con->insert_id]);
    }

    case 'getUnprocessedWebhooks': {
        $limit = max(1, min(200, (int)($params['limit'] ?? 50)));
        $stmt = $con->prepare("SELECT * FROM webhook_queue WHERE processed = 0 ORDER BY created_at ASC LIMIT ?");
        $stmt->bind_param('i', $limit);
        $stmt->execute();
        respond(fetchAll($stmt));
    }

    case 'markWebhookProcessed': {
        requireParams($params, ['id']);
        $id = (int)$params['id'];
        $stmt = $con->prepare("UPDATE webhook_queue SET processed = 1, processed_at = NOW() WHERE id = ?");
        $stmt->bind_param('i', $id);
        $stmt->execute();
        respond(['updated' => $stmt->affected_rows > 0]);
    }

    default:
        fail('Unknown action: ' . $action, 404);
}
