import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMali } from '../context/MaliContext';
import { pickReceiptImagesFromDevice } from '../utils/receiptPicker';
import { MAX_RECEIPTS, type ReceiptSource } from '../utils/receiptCore';

export { pickReceiptImagesFromDevice } from '../utils/receiptPicker';
const EMPTY_RECEIPTS: string[] = [];

function useReceiptSelection(images: string[], onChange?: (images: string[]) => void | boolean) {
  const mounted=useRef(true), locked=useRef(false), latestImages=useRef(images), imagesVersion=useRef(0);
  const [isPicking,setIsPicking]=useState(false);
  const [message,setMessage]=useState<string | null>(null);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  useEffect(()=>{if (latestImages.current !== images) imagesVersion.current++;latestImages.current=images;},[images]);
  const pick=async (source: ReceiptSource) => {
    if (!onChange || locked.current) return;
    locked.current=true;setIsPicking(true);setMessage(null);
    const before=[...images], version=imagesVersion.current;
    try {
      const result=await pickReceiptImagesFromDevice(before.length,source);
      if (!mounted.current) return;
      if (result.status !== 'selected') { setMessage(result.message || 'تعذر اختيار الصور.');return; }
      if (imagesVersion.current !== version || latestImages.current.length !== before.length || latestImages.current.some((image,index)=>image !== before[index])) {
        setMessage('تغيّرت الصور أثناء الاختيار. أعد إرفاق الصور المطلوبة.');return;
      }
      if (onChange([...before,...result.images]) === false) setMessage('تعذر إرفاق الصور بالخزنة. حاول مجدداً.');
    } catch { if (mounted.current) setMessage('تعذر إرفاق الصور بالخزنة. حاول مجدداً.');
    } finally { locked.current=false;if (mounted.current) setIsPicking(false); }
  };
  return {pick,isPicking,message,disabled:isPicking || images.length >= MAX_RECEIPTS};
}

interface ReceiptAttachmentFieldProps {
  label?: string;
  images: string[];
  onChange: (nextImages: string[]) => void | boolean;
  accentColor?: string;
}

/**
 * Used inside Buy & Sell Modals to let the user optionally attach one or more transfer receipt photos.
 */
export const ReceiptAttachmentField: React.FC<ReceiptAttachmentFieldProps> = ({
  label = 'صور الحوالة المالية / الإيصال (اختياري):',
  images,
  onChange,
  accentColor,
}) => {
  const { theme } = useMali();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const activeColor = accentColor || theme.primary;
  const selection=useReceiptSelection(images,onChange);

  const handleRemove = (idx: number) => {
    onChange(images.filter((_, i) => i !== idx));
  };

  return (
    <View style={styles.fieldContainer}>
      <View style={styles.headerRow}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>
          {label}
        </Text>
        <TouchableOpacity
          style={[
            styles.attachBtn,
            {
              backgroundColor: theme.cardAlt,
              borderColor: activeColor,
            },
          ]}
          onPress={() => { void selection.pick('library'); }}
          disabled={selection.disabled}
          accessibilityRole="button"
          accessibilityLabel="اختيار صور إيصال من المعرض"
          accessibilityState={{disabled:selection.disabled,busy:selection.isPicking}}
          activeOpacity={0.75}
        >
          <Ionicons name="image-outline" size={16} color={activeColor} />
          <Text style={[styles.attachBtnText, { color: activeColor }]}>
            {selection.isPicking ? 'جارٍ تجهيز الصور…' : images.length > 0 ? '+ إضافة صورة' : 'إرفاق صورة'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.cameraBtn,{borderColor:activeColor,backgroundColor:theme.cardAlt}]}
          accessibilityRole="button" accessibilityLabel="التقاط صورة إيصال بالكاميرا" disabled={selection.disabled}
          accessibilityState={{disabled:selection.disabled,busy:selection.isPicking}} onPress={() => { void selection.pick('camera'); }}>
          <Ionicons name="camera-outline" size={20} color={activeColor} />
        </TouchableOpacity>
      </View>

      {(selection.message || images.length >= MAX_RECEIPTS) && <Text accessibilityRole="alert" style={[styles.pickerMessage,{color:theme.textSecondary}]}>
        {selection.message || 'تم بلوغ الحد الأقصى (4 صور). احذف صورة لإضافة أخرى.'}
      </Text>}

      {images.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbScroll}
        >
          {images.map((uri, idx) => (
            <View
              key={`${idx}-${uri.slice(-12)}`}
              style={[styles.thumbWrapper, { borderColor: theme.border }]}
            >
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setViewerIndex(idx)}
                accessibilityRole="button"
                accessibilityLabel={`عرض صورة الإيصال ${idx + 1}`}
              >
                <Image
                  source={{ uri }}
                  style={styles.thumbImage}
                  resizeMode="cover"
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.removeBadge,
                  { backgroundColor: theme.danger },
                ]}
                onPress={() => handleRemove(idx)}
                accessibilityRole="button"
                accessibilityLabel={`حذف صورة الإيصال ${idx + 1}`}
                hitSlop={12}
              >
                <Ionicons name="close" size={12} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      <ReceiptViewerModal
        visible={viewerIndex !== null}
        images={images}
        initialIndex={viewerIndex || 0}
        title="صورة الحوالة المرفقة"
        onClose={() => setViewerIndex(null)}
        onDeleteImage={(idx) => {
          const next = images.filter((_, i) => i !== idx);
          onChange(next);
          if (next.length === 0) setViewerIndex(null);
        }}
      />
    </View>
  );
};

interface ReceiptInlineStripProps {
  images?: string[];
  title: string;
  onUpdateImages?: (nextImages: string[]) => void | boolean;
  accentColor?: string;
  compactLabel?: string;
}

/**
 * Compact inline strip displayed inside Deal Cards (Buy moment & Sell moment)
 * and Contact Ledgers to view or attach transfer receipt images on the fly.
 */
export const ReceiptInlineStrip: React.FC<ReceiptInlineStripProps> = ({
  images = EMPTY_RECEIPTS,
  title,
  onUpdateImages,
  accentColor,
  compactLabel = 'صورة الحوالة',
}) => {
  const { theme } = useMali();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const color = accentColor || theme.primary;
  const selection=useReceiptSelection(images,onUpdateImages);
  const handleQuickAdd=()=>selection.pick('library');

  if (images.length === 0 && !onUpdateImages) {
    return null;
  }

  return (
    <View>
      <View style={styles.inlineRow}>
      {images.length > 0 ? (
        <View style={styles.inlineThumbsGroup}>
          <TouchableOpacity
            style={[
              styles.viewPill,
              {
                backgroundColor: theme.card,
                borderColor: color,
              },
            ]}
            onPress={() => setViewerIndex(0)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`عرض ${compactLabel} (${images.length})`}
          >
            <Image
              source={{ uri: images[0] }}
              style={styles.miniThumb}
              resizeMode="cover"
            />
            <Ionicons name="image-outline" size={13} color={color} />
            <Text style={[styles.viewPillText, { color }]}>
              عرض {compactLabel} ({images.length})
            </Text>
          </TouchableOpacity>

          {onUpdateImages && (
            <TouchableOpacity
              style={[
                styles.addMoreMiniBtn,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                },
              ]}
              onPress={handleQuickAdd}
              disabled={selection.disabled}
              accessibilityRole="button"
              accessibilityLabel="إضافة صور إيصال من المعرض"
              accessibilityState={{disabled:selection.disabled,busy:selection.isPicking}}
            >
              <Ionicons name="add" size={14} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      ) : (
        onUpdateImages && (
          <TouchableOpacity
            style={[
              styles.emptyAttachChip,
              {
                backgroundColor: theme.card,
                borderColor: theme.border,
              },
            ]}
            onPress={handleQuickAdd}
            disabled={selection.disabled}
            accessibilityRole="button"
            accessibilityLabel="اختيار صور إيصال من المعرض"
            accessibilityState={{disabled:selection.disabled,busy:selection.isPicking}}
            activeOpacity={0.75}
          >
            <Ionicons
              name="camera-outline"
              size={13}
              color={theme.textSecondary}
            />
            <Text
              style={[
                styles.emptyAttachChipText,
                { color: theme.textSecondary },
              ]}
            >
              + إرفاق {compactLabel}
            </Text>
          </TouchableOpacity>
        )
      )}
      {onUpdateImages && <TouchableOpacity style={[styles.cameraBtn,{borderColor:theme.border,backgroundColor:theme.card}]}
        disabled={selection.disabled} accessibilityRole="button" accessibilityLabel="التقاط صورة إيصال بالكاميرا"
        accessibilityState={{disabled:selection.disabled,busy:selection.isPicking}} onPress={() => { void selection.pick('camera'); }}>
        <Ionicons name="camera-outline" size={18} color={color} />
      </TouchableOpacity>}
      </View>
      {(selection.message || images.length >= MAX_RECEIPTS) && <Text accessibilityRole="alert" style={[styles.pickerMessage,{color:theme.textSecondary}]}>
        {selection.message || 'تم بلوغ الحد الأقصى (4 صور). احذف صورة لإضافة أخرى.'}
      </Text>}

      <ReceiptViewerModal
        visible={viewerIndex !== null}
        images={images}
        initialIndex={viewerIndex || 0}
        title={title}
        onClose={() => setViewerIndex(null)}
        onAddMore={onUpdateImages && !selection.disabled ? handleQuickAdd : undefined}
        onDeleteImage={
          onUpdateImages
            ? (idx) => {
                const next = images.filter((_, i) => i !== idx);
                onUpdateImages(next);
                if (next.length === 0) setViewerIndex(null);
              }
            : undefined
        }
      />
    </View>
  );
};

interface ReceiptViewerModalProps {
  visible: boolean;
  images: string[];
  initialIndex?: number;
  title: string;
  onClose: () => void;
  onAddMore?: () => void;
  onDeleteImage?: (index: number) => void;
}

export const ReceiptViewerModal: React.FC<ReceiptViewerModalProps> = (props) => (
  props.visible ? <ReceiptViewerContent key={props.initialIndex ?? 0} {...props} /> : null
);

const ReceiptViewerContent: React.FC<ReceiptViewerModalProps> = ({
  visible,
  images,
  initialIndex = 0,
  title,
  onClose,
  onAddMore,
  onDeleteImage,
}) => {
  const { theme } = useMali();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  if (!visible || images.length === 0) return null;
  const boundedIndex = Math.max(0, Math.min(currentIndex, images.length - 1));

  const activeUri =
    images[boundedIndex] || images[0];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={[styles.modalBackdrop, { backgroundColor: 'rgba(15,23,42,0.88)' }]}
      >
        <View
          style={[
            styles.viewerCard,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          {/* Header */}
          <View style={styles.viewerHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.viewerTitle, { color: theme.text }]}>
                {title}
              </Text>
              <Text
                style={[styles.viewerSub, { color: theme.textSecondary }]}
              >
                صورة {boundedIndex + 1} من{' '}
                {images.length}
              </Text>
            </View>

            <View style={styles.viewerHeaderActions}>
              {onAddMore && (
                <TouchableOpacity
                  style={[
                    styles.headerActionBtn,
                    {
                      backgroundColor: theme.primarySoft,
                      borderColor: theme.primary,
                    },
                  ]}
                  onPress={onAddMore}
                >
                  <Ionicons
                    name="camera-outline"
                    size={16}
                    color={theme.primary}
                  />
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: 'bold',
                      color: theme.primary,
                    }}
                  >
                    + صورة
                  </Text>
                </TouchableOpacity>
              )}

              {onDeleteImage && (
                <TouchableOpacity
                  style={[
                    styles.headerActionBtn,
                    {
                      backgroundColor: theme.dangerSoft,
                      borderColor: theme.danger,
                    },
                  ]}
                  onPress={() => onDeleteImage(boundedIndex)}
                >
                  <Ionicons
                    name="trash-outline"
                    size={16}
                    color={theme.danger}
                  />
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.closeCircleBtn,
                  { backgroundColor: theme.cardAlt },
                ]}
                onPress={onClose}
              >
                <Ionicons name="close" size={20} color={theme.text} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Main Image Preview */}
          <View
            style={[
              styles.imageStage,
              { backgroundColor: theme.bg, borderColor: theme.border },
            ]}
          >
            <Image
              source={{ uri: activeUri }}
              style={styles.fullImage}
              resizeMode="contain"
            />
          </View>

          {/* Thumbnails Switcher if multiple */}
          {images.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.viewerThumbBar}
            >
              {images.map((imgUri, idx) => {
                const isSelected = idx === boundedIndex;
                return (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => setCurrentIndex(idx)}
                    style={[
                      styles.viewerThumbItem,
                      {
                        borderColor: isSelected
                          ? theme.primary
                          : theme.border,
                        borderWidth: isSelected ? 2.5 : 1,
                      },
                    ]}
                  >
                    <Image
                      source={{ uri: imgUri }}
                      style={styles.viewerThumbImg}
                      resizeMode="cover"
                    />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fieldContainer: {
    marginTop: 10,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
  },
  attachBtn: {
    minHeight: 44,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  cameraBtn: {minWidth:44,minHeight:44,borderWidth:1,borderRadius:10,alignItems:'center',justifyContent:'center',marginHorizontal:4},
  pickerMessage: {fontSize:12,textAlign:'right',marginTop:6},
  attachBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  thumbScroll: {
    flexDirection: 'row-reverse',
    gap: 10,
    paddingTop: 10,
    paddingBottom: 4,
  },
  thumbWrapper: {
    width: 58,
    height: 58,
    borderRadius: 10,
    borderWidth: 1,
    position: 'relative',
    overflow: 'visible',
  },
  thumbImage: {
    width: 56,
    height: 56,
    borderRadius: 9,
  },
  removeBadge: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginTop: 6,
  },
  inlineThumbsGroup: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  viewPill: {
    minHeight:44,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  miniThumb: {
    width: 20,
    height: 20,
    borderRadius: 4,
  },
  viewPillText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  addMoreMiniBtn: {
    minWidth:44,minHeight:44,
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyAttachChip: {
    minHeight:44,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  emptyAttachChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  viewerCard: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  viewerHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  viewerTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  viewerSub: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 2,
  },
  viewerHeaderActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  headerActionBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  closeCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageStage: {
    width: '100%',
    height: 390,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  viewerThumbBar: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 12,
    paddingVertical: 2,
  },
  viewerThumbItem: {
    width: 52,
    height: 52,
    borderRadius: 8,
    overflow: 'hidden',
  },
  viewerThumbImg: {
    width: '100%',
    height: '100%',
  },
});
