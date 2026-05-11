import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges
} from '@angular/core';

import { CommonModule } from '@angular/common';

interface ProductItem {

  id: string;

  name: string;

  remarks?: string;

  messageType?: 'error' | 'warning' | 'info';

  selected: boolean;

  value: number | string;

  deleted: boolean;

}

interface PendingChange {

  action: 'EDIT' | 'DELETE';

  currentValue: number | string;

}

@Component({
  selector: 'app-gcp-product-errors',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './gcp-product-errors.component.html',
})
export class GcpProductErrorsComponent implements OnInit, OnChanges {

  @Input() items: ProductItem[] = [];

  @Input() isDiscountMode: boolean = true;

  @Output() close =
    new EventEmitter<void>();

  @Output() submitPayload =
    new EventEmitter<any>();

  bulkValue: number | null = null;

  isAllSelected: boolean = false;

  isPageLoading: boolean = false;

  private pendingChanges =
    new Map<string, PendingChange>();

  ngOnInit(): void {
    // handled by ngOnChanges
  }

  ngOnChanges(
    changes: SimpleChanges
  ): void {

    if (
      changes['items'] &&
      changes['items'].currentValue
    ) {

      this.initializeItems();

    }

  }

  initializeItems(): void {

    this.items = this.items.map(item => ({

      ...item,

      selected:
        item.selected ?? false,

      deleted:
        item.deleted ?? false,

      value:
        item.value ??
        (this.isDiscountMode ? 0 : ''),

      remarks:
        item.remarks ?? '',

      messageType:
        item.messageType ?? 'error'

    }));

    this.updateSelectAllState();

  }

  toggleSelection(id: string): void {

    const item =
      this.items.find(i => i.id === id);

    if (!item || item.deleted) {
      return;
    }

    item.selected = !item.selected;

    this.updateSelectAllState();

  }

  toggleSelectAll(): void {

    const nextState =
      !this.isAllSelected;

    this.items.forEach(item => {

      if (!item.deleted) {

        item.selected = nextState;

      }

    });

    this.isAllSelected = nextState;

  }

  updateItemValue(
    id: string,
    event: Event
  ): void {

    const item =
      this.items.find(i => i.id === id);

    if (!item || item.deleted) {
      return;
    }

    const input =
      (event.target as HTMLInputElement).value;

    if (this.isDiscountMode) {

      const value =
        Number(input || 0);

      item.value =
        Math.max(0, value);

    } else {

      item.value = input;

    }

    this.pendingChanges.set(id, {

      action: 'EDIT',

      currentValue:
        item.value

    });

  }

  updateBulkValue(event: Event): void {

    const value =
      (event.target as HTMLInputElement).value;

    this.bulkValue =
      value === ''
        ? null
        : Math.max(0, Number(value));

  }

  applyBulkValue(): void {

    if (
      this.bulkValue === null ||
      !this.isDiscountMode
    ) {
      return;
    }

    this.items.forEach(item => {

      if (
        item.selected &&
        !item.deleted
      ) {

        item.value =
          Number(this.bulkValue);

        this.pendingChanges.set(item.id, {

          action: 'EDIT',

          currentValue:
            item.value

        });

      }

    });

    this.bulkValue = null;

  }

  removeItem(id: string): void {

    const item =
      this.items.find(i => i.id === id);

    if (!item) {
      return;
    }

    item.deleted = true;

    item.selected = false;

    this.pendingChanges.set(id, {

      action: 'DELETE',

      currentValue:
        item.value

    });

    this.updateSelectAllState();

  }

  restoreItem(id: string): void {

    const item =
      this.items.find(i => i.id === id);

    if (!item) {
      return;
    }

    item.deleted = false;

    item.selected = false;

    this.pendingChanges.delete(id);

    this.updateSelectAllState();

  }

  updateSelectAllState(): void {

    const activeItems =
      this.items.filter(
        item => !item.deleted
      );

    this.isAllSelected =
      activeItems.length > 0 &&
      activeItems.every(
        item => item.selected
      );

  }

  onDiscountFocus(
    event: FocusEvent,
    currentValue: number | string
  ): void {

    if (
      this.isDiscountMode &&
      currentValue === 0
    ) {

      (
        event.target as HTMLInputElement
      ).value = '';

    }

  }

  trackById(
    index: number,
    item: ProductItem
  ): string {

    return item.id;

  }

  restrictNumeric(
    event: KeyboardEvent
  ): void {

    if (!this.isDiscountMode) {
      return;
    }

    const allowedKeys = [
      'Backspace',
      'Tab',
      'Enter',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Delete',
      '.'
    ];

    if (
      allowedKeys.includes(event.key) ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    if (!/^[0-9]$/.test(event.key)) {

      event.preventDefault();

    }

  }

  closeModal(): void {

    this.close.emit();

  }

  onSubmit(): void {

    const edits: any[] = [];

    const deletes: any[] = [];

    this.pendingChanges.forEach(
      (change, id) => {

        if (
          change.action === 'DELETE'
        ) {

          deletes.push({ id });

        } else {

          edits.push({

            id,

            value:
              change.currentValue,

            type:
              this.isDiscountMode
                ? 'discount'
                : 'incentive'

          });

        }

      }
    );

    this.submitPayload.emit({

      edits,

      deletes,

      updatedItems:
        this.items,

      mode:
        this.isDiscountMode
          ? 'discount'
          : 'incentive'

    });

    this.closeModal();

  }

}