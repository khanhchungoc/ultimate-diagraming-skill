# Brief: Multi-tenant SaaS for clinics (ER diagram, physical schema)

Tenancy and users: tenant(id, name, plan, created_at). user_account(id, tenant_id, email unique, password_hash, status, last_login_at). role(id, tenant_id, name). user_role(user_id, role_id) junction. permission(id, code unique). role_permission(role_id, permission_id) junction. audit_log(id, tenant_id, user_id nullable, action, entity, entity_id, at).

Clinics and staff: clinic(id, tenant_id, name, timezone, address_id). address(id, line1, line2 nullable, city, postcode, country). staff(id, clinic_id, user_id unique nullable, first_name, last_name, title). specialty(id, name). staff_specialty(staff_id, specialty_id). room(id, clinic_id, name, kind). shift(id, staff_id, room_id nullable, starts_at, ends_at).

Patients: patient(id, tenant_id, mrn unique per tenant, first_name, last_name, dob, sex, address_id nullable). patient_contact(id, patient_id, kind, value, is_primary). emergency_contact(id, patient_id, name, relation, phone). insurance_provider(id, name, payer_code). patient_insurance(id, patient_id, provider_id, policy_number, valid_from, valid_to nullable). consent(id, patient_id, kind, granted_at, revoked_at nullable).

Scheduling: appointment_type(id, clinic_id, name, duration_min, price). appointment(id, patient_id, staff_id, room_id nullable, type_id, starts_at, status: booked/arrived/done/no_show/cancelled). waitlist_entry(id, patient_id, type_id, requested_at). reminder(id, appointment_id, channel, send_at, sent_at nullable).

Clinical: encounter(id, appointment_id unique, started_at, ended_at nullable). diagnosis_code(code pk, description). encounter_diagnosis(encounter_id, code). procedure_code(code pk, description, base_price). encounter_procedure(encounter_id, code, qty). prescription(id, encounter_id, drug_id, dose, frequency, days). drug(id, name, atc_code). allergy(id, patient_id, substance, severity). clinical_note(id, encounter_id, author_staff_id, body, signed_at nullable). lab_order(id, encounter_id, test_code, status). lab_result(id, lab_order_id, value, unit, flag, resulted_at). attachment(id, encounter_id, file_key, mime, uploaded_by).

Billing: invoice(id, tenant_id, patient_id, encounter_id nullable, number unique, status, issued_at, due_at). invoice_line(id, invoice_id, procedure_code nullable, description, qty, unit_price). payment(id, invoice_id, amount, method, paid_at). claim(id, invoice_id, patient_insurance_id, status, submitted_at). claim_response(id, claim_id, status, paid_amount, received_at). refund(id, payment_id, amount, reason). price_list(id, clinic_id, valid_from). price_list_item(price_list_id, procedure_code, price).

Messaging and integrations: message_thread(id, patient_id, subject). message(id, thread_id, sender_user_id nullable, body, sent_at). webhook_endpoint(id, tenant_id, url, secret). webhook_delivery(id, endpoint_id, event, status, attempts). schema_migration(version pk, applied_at) — no relations.

Rules: every tenant-scoped table is filtered by tenant_id; invoices are immutable after issue (corrections by credit note lines); clinical notes cannot be edited after signing; audit_log is append-only.
