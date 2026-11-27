import { PhoneOrderCard } from "@/components/pharmacy-orders/phone-order-card"

export default async function PharmacyPhoneOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PhoneOrderCard orderId={id} />
}
