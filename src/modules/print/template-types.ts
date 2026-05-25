export interface ComandaTemplate {
  print_mode: 'grouped' | 'per_item' | 'per_category';
  show_order_number: boolean;
  show_table: boolean;
  show_waiter: boolean;
  show_time: boolean;
  show_modifiers: boolean;
  show_notes: boolean;
  show_voided: boolean;
  header_text: string;
  footer_text: string;
  margin_top: number;
  margin_bottom: number;
}

export interface ReceiptTemplate {
  show_business_name: boolean;
  show_address: boolean;
  show_order_number: boolean;
  show_datetime: boolean;
  show_cashier: boolean;
  show_table: boolean;
  show_modifiers: boolean;
  show_subtotal: boolean;
  show_tax: boolean;
  show_discount: boolean;
  show_tip: boolean;
  show_total: boolean;
  show_payments: boolean;
  show_change: boolean;
  thank_you_text: string;
  margin_top: number;
  margin_bottom: number;
}

export const DEFAULT_COMANDA_TEMPLATE: ComandaTemplate = {
  print_mode: 'grouped',
  show_order_number: true,
  show_table: true,
  show_waiter: true,
  show_time: true,
  show_modifiers: true,
  show_notes: true,
  show_voided: true,
  header_text: 'ORDER',
  footer_text: '',
  margin_top: 0,
  margin_bottom: 0,
};

export const DEFAULT_RECEIPT_TEMPLATE: ReceiptTemplate = {
  show_business_name: true,
  show_address: true,
  show_order_number: true,
  show_datetime: true,
  show_cashier: true,
  show_table: true,
  show_modifiers: true,
  show_subtotal: true,
  show_tax: true,
  show_discount: true,
  show_tip: true,
  show_total: true,
  show_payments: true,
  show_change: true,
  thank_you_text: 'Thank you!',
  margin_top: 0,
  margin_bottom: 0,
};
