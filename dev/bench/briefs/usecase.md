# Brief: Public library platform (UML use case diagram)

Systems: Library Web Portal, Branch Circulation System, Back-office Admin.

Actors: Visitor (not logged in), Member (a Visitor who registered), Student Member (a Member with a student card), Librarian, Branch Manager, Cataloguer, Payment Gateway (system), Email Service (system), ID Verification Service (system), Nightly Scheduler (time).

Portal: Visitors search the catalogue (FR-01), view item details (FR-02), browse new arrivals (FR-03) and register for membership (FR-04); registration always includes verifying identity through the ID Verification Service (FR-05). Members log in (FR-06), place holds (FR-07), cancel holds (FR-08), renew loans (FR-09), view loan history (FR-10), pay fines online (FR-11, always includes taking payment via the Payment Gateway), update their profile (FR-12), manage reading lists (FR-13), write reviews (FR-14), book study rooms (FR-15), and register for events (FR-16). Renewing a loan is extended by "Pay outstanding fine" when the member owes more than 5 EUR. Placing a hold may be extended by "Join waitlist" when all copies are on hold. Student Members additionally request inter-library loans (FR-17) and access e-journals (FR-18).

Branch: Librarians check out items (FR-20), check in items (FR-21), both always include scanning the item barcode; issue library cards (FR-22), waive fines (FR-23), handle lost items (FR-24, extended by "Charge replacement fee" when the item is not found within 30 days), process holds pickup (FR-25), and register walk-in members (FR-26, includes verifying identity). Branch Managers approve fine waivers above 50 EUR (FR-27), view branch reports (FR-28), manage staff rotas (FR-29) and manage events (FR-30).

Back-office: Cataloguers add catalogue records (FR-40), edit records (FR-41), import MARC records (FR-42), merge duplicate records (FR-43), and withdraw items (FR-44). The Nightly Scheduler sends due-date reminders (FR-50) and overdue notices (FR-51), both include sending email via the Email Service; it also expires uncollected holds (FR-52) and recalculates fines (FR-53).

Rules: members are suspended at 20 EUR of unpaid fines (BR-1); students may borrow up to 15 items, others 10 (BR-2); study rooms are bookable 14 days ahead for at most 3 hours a day (BR-3).
