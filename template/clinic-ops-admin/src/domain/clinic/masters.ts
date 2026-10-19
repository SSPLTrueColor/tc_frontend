import type { MasterDefinition, MasterValue, Tone } from '../../metadata/types';

const v = (key: string, label: string, tone: Tone = 'neutral', parent?: string): Omit<MasterValue, 'order'> => ({
  key,
  label,
  tone,
  parent,
  active: true,
});

function master(key: string, label: string, values: Omit<MasterValue, 'order'>[], description?: string): MasterDefinition {
  return {
    id: `mst_${key}`,
    key,
    label,
    description,
    version: 1,
    values: values.map((x, i) => ({ ...x, order: i })),
  };
}

/** Shared masters — immutable keys, editable labels via Configuration Studio. */
export const clinicMasters: MasterDefinition[] = [
  master('patientStatus', 'Patient status', [
    v('new', 'New', 'info'),
    v('active', 'Active', 'success'),
    v('inactive', 'Inactive', 'neutral'),
  ]),
  master('contactPreference', 'Contact preference', [v('phone', 'Phone call'), v('email', 'Email'), v('sms', 'Text message')]),
  master(
    'payer',
    'Payer',
    [
      v('self_pay', 'Self-pay'),
      v('northstar', 'Northstar Health Plan', 'info'),
      v('meridian', 'Meridian Mutual', 'info'),
      v('civic', 'Civic Community Plan', 'info'),
    ],
    'Fictional payer names for synthetic data.',
  ),
  master('accessNeeds', 'Access needs', [
    v('interpreter', 'Interpreter'),
    v('wheelchair', 'Wheelchair access'),
    v('large_print', 'Large print'),
    v('hearing_loop', 'Hearing loop'),
  ]),
  master('appointmentStatus', 'Appointment status', [
    v('scheduled', 'Scheduled', 'info'),
    v('confirmed', 'Confirmed', 'accent'),
    v('checked_in', 'Checked in', 'warning'),
    v('in_progress', 'In visit', 'warning'),
    v('completed', 'Completed', 'success'),
    v('cancelled', 'Cancelled', 'neutral'),
    v('no_show', 'No-show', 'danger'),
  ]),
  master('appointmentType', 'Appointment type', [
    v('new_patient', 'New patient visit'),
    v('follow_up', 'Follow-up'),
    v('annual_review', 'Annual review'),
    v('procedure_slot', 'Procedure slot'),
    v('telehealth_check', 'Telehealth check-in'),
  ]),
  master('visitMode', 'Visit mode', [v('in_person', 'In person'), v('telehealth', 'Telehealth')]),
  master('bookingChannel', 'Booking channel', [
    v('phone', 'Phone'),
    v('front_desk', 'Front desk'),
    v('walk_in', 'Walk-in'),
    v('referral', 'Referral'),
  ]),
  master('staffRole', 'Staff role', [
    v('practice_manager', 'Practice manager'),
    v('physician', 'Physician'),
    v('nurse_practitioner', 'Nurse practitioner'),
    v('nurse', 'Nurse'),
    v('physiotherapist', 'Physiotherapist'),
    v('front_desk', 'Front desk'),
    v('billing', 'Billing specialist'),
  ]),
  master('department', 'Department', [
    v('family_medicine', 'Family medicine'),
    v('pediatrics', 'Pediatrics'),
    v('dermatology', 'Dermatology'),
    v('physiotherapy', 'Physiotherapy'),
    v('operations', 'Operations'),
  ]),
  master('staffStatus', 'Staff status', [v('active', 'Active', 'success'), v('on_leave', 'On leave', 'warning'), v('inactive', 'Inactive')]),
  master('weekday', 'Weekday', [v('mon', 'Mon'), v('tue', 'Tue'), v('wed', 'Wed'), v('thu', 'Thu'), v('fri', 'Fri'), v('sat', 'Sat')]),
  master('roomType', 'Room type', [
    v('consult', 'Consult room'),
    v('procedure', 'Procedure room'),
    v('treatment', 'Treatment room'),
    v('telehealth', 'Telehealth booth'),
  ]),
  master('roomStatus', 'Room status', [
    v('available', 'Available', 'success'),
    v('maintenance', 'Maintenance', 'warning'),
    v('out_of_service', 'Out of service', 'danger'),
  ]),
  master('invoiceStatus', 'Invoice status', [
    v('draft', 'Draft'),
    v('issued', 'Issued', 'info'),
    v('partially_paid', 'Partially paid', 'warning'),
    v('paid', 'Paid', 'success'),
    v('written_off', 'Written off', 'accent'),
    v('void', 'Void', 'danger'),
  ]),
  master('serviceCode', 'Billable service', [
    v('consult_std', 'Standard consultation'),
    v('consult_ext', 'Extended consultation'),
    v('follow_up', 'Follow-up visit'),
    v('procedure_minor', 'Minor procedure'),
    v('telehealth', 'Telehealth session'),
    v('admin_fee', 'Administrative fee'),
  ]),
  master('referralStatus', 'Referral status', [
    v('received', 'Received', 'info'),
    v('in_review', 'In review', 'warning'),
    v('scheduled', 'Scheduled', 'accent'),
    v('closed', 'Closed', 'success'),
    v('declined', 'Declined', 'neutral'),
  ]),
  master('specialty', 'Referral specialty', [
    v('cardiology', 'Cardiology'),
    v('orthopedics', 'Orthopedics'),
    v('dermatology', 'Dermatology'),
    v('imaging', 'Imaging'),
  ]),
  master(
    'referralService',
    'Referral service',
    [
      v('cardio_consult', 'Cardiology consult', 'neutral', 'cardiology'),
      v('stress_test', 'Stress test booking', 'neutral', 'cardiology'),
      v('ortho_consult', 'Orthopedic consult', 'neutral', 'orthopedics'),
      v('sports_clinic', 'Sports injury clinic', 'neutral', 'orthopedics'),
      v('derm_consult', 'Dermatology consult', 'neutral', 'dermatology'),
      v('xray', 'X-ray booking', 'neutral', 'imaging'),
      v('ultrasound', 'Ultrasound booking', 'neutral', 'imaging'),
    ],
    'Dependent on Referral specialty.',
  ),
  master('urgency', 'Urgency', [v('routine', 'Routine'), v('soon', 'Soon', 'warning'), v('urgent', 'Urgent', 'danger')]),
  master('taskStatus', 'Task status', [
    v('todo', 'To do'),
    v('in_progress', 'In progress', 'info'),
    v('blocked', 'Blocked', 'danger'),
    v('done', 'Done', 'success'),
  ]),
  master('priority', 'Priority', [v('low', 'Low'), v('normal', 'Normal', 'info'), v('high', 'High', 'warning'), v('urgent', 'Urgent', 'danger')]),
];
